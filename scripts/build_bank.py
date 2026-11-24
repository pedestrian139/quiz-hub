"""Merge, normalize, deduplicate, and assemble src/data/bank.json.

Inputs:
  - scripts/raw_comprehensive.json   (origin: comprehensive_bank)
  - scripts/raw_video_1.json         (origin: video_popup)
  - scripts/raw_video_2.json         (origin: video_popup)
  - scripts/raw_synthesized.json     (origin: review_notes_synthesized)
  - src/data/notes.json              (authoritative 9 ChapterMeta definitions)

Output:
  - src/data/bank.json               (BankData conforming to src/types/quiz.ts)
"""

from __future__ import annotations

import argparse
import difflib
import json
import re
import sys
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

REPO_ROOT = Path(__file__).resolve().parent.parent
SCRIPTS_DIR = REPO_ROOT / "scripts"
DATA_DIR = REPO_ROOT / "src" / "data"
FALLBACK_RAW_DIRS: list[Path] = [
    SCRIPTS_DIR,
    Path(r"c:\Users\123\Desktop\antigravity"),
]

RAW_SOURCES: list[tuple[str, str, int]] = [
    ("raw_comprehensive.json", "comprehensive_bank", 0),
    ("raw_video_1.json", "video_popup", 1),
    ("raw_video_2.json", "video_popup", 1),
    ("raw_synthesized.json", "review_notes_synthesized", 2),
]

VALID_TYPES = ("choice", "multi", "tf", "short", "analysis")
VALID_ORIGINS = ("comprehensive_bank", "video_popup", "review_notes_synthesized")
TYPE_ORDER = {t: i for i, t in enumerate(VALID_TYPES)}
ORIGIN_ORDER = {o: i for i, o in enumerate(VALID_ORIGINS)}

# Strip accidental leading item numbers like "1. ", "12、", "3）", "(4) "
# Carefully avoids stripping years like "1943 年" or "20 世纪".
_LEADING_NUM_RE = re.compile(
    r"^\s*(?:[\(（]\s*\d{1,3}\s*[\)）]|\d{1,3}\s*[\.\、\)\）]|第\s*\d{1,3}\s*题[\s:：\.、]*)\s*"
)

# Strip accidental option letter prefixes like "A. ", "B、", "C) ", "D）", "A: "
_OPTION_PREFIX_RE = re.compile(r"^\s*[A-Ha-h]\s*[\.\、\)\）:：]\s*")

# Collapse non-word/punctuation characters for fuzzy deduplication keys
_DEDUP_STRIP_RE = re.compile(r"[\s\W_]+", re.UNICODE)


def collapse_inline_ws(text: str) -> str:
    """Normalize inline whitespace and remove stray control characters."""
    cleaned = re.sub(r"[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]", "", text)
    cleaned = cleaned.replace("\u3000", " ").replace("\u00a0", " ")
    cleaned = re.sub(r"[ \t\r\n]+", " ", cleaned)
    return cleaned.strip()


def normalize_multiline(text: str) -> str:
    """Normalize multiline prose while preserving intentional paragraph/bullet line breaks."""
    cleaned = re.sub(r"[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]", "", text)
    cleaned = cleaned.replace("\r\n", "\n").replace("\r", "\n")
    cleaned = cleaned.replace("\u3000", " ").replace("\u00a0", " ")
    lines = [re.sub(r"[ \t]+", " ", line).strip() for line in cleaned.split("\n")]
    joined = "\n".join(lines)
    joined = re.sub(r"\n{3,}", "\n\n", joined)
    return joined.strip()


def clean_stem(stem: str) -> str:
    s = collapse_inline_ws(stem)
    s = _LEADING_NUM_RE.sub("", s).strip()
    return s


def clean_option(opt: str) -> str:
    s = collapse_inline_ws(opt)
    s = _OPTION_PREFIX_RE.sub("", s).strip()
    return s


def dedup_key(text: str) -> str:
    return _DEDUP_STRIP_RE.sub("", text.lower())


def stem_exact_key(text: str) -> str:
    return re.sub(r"\s+", " ", text).strip()


def normalize_question(raw: dict[str, Any], default_origin: str, source_filename: str) -> dict[str, Any]:
    """Normalize a raw question object to strictly conform to Question in src/types/quiz.ts."""
    q_type = str(raw.get("type", "")).strip()
    if q_type not in VALID_TYPES:
        raise ValueError(f"[{source_filename}] Invalid question type {q_type!r} in id={raw.get('id')!r}")

    q_id = collapse_inline_ws(str(raw.get("id", "")))
    if not q_id:
        raise ValueError(f"[{source_filename}] Missing question id in entry: {raw!r}")

    chapter = raw.get("chapter")
    if isinstance(chapter, bool) or not isinstance(chapter, int) or not (1 <= chapter <= 9):
        raise ValueError(f"[{source_filename}] Invalid chapter {chapter!r} in id={q_id!r}")

    stem = clean_stem(str(raw.get("stem", "")))
    if not stem:
        raise ValueError(f"[{source_filename}] Empty stem in id={q_id!r}")

    src_raw = raw.get("source") or {}
    if not isinstance(src_raw, dict):
        raise ValueError(f"[{source_filename}] Invalid source field in id={q_id!r}")

    origin = str(src_raw.get("origin") or default_origin).strip()
    if origin not in VALID_ORIGINS:
        raise ValueError(f"[{source_filename}] Invalid source.origin {origin!r} in id={q_id!r}")

    src_file = collapse_inline_ws(str(src_raw.get("file", "")))
    src_ref = collapse_inline_ws(str(src_raw.get("ref", "")))
    if not src_file or not src_ref:
        raise ValueError(f"[{source_filename}] Missing source.file or source.ref in id={q_id!r}")

    source: dict[str, Any] = {
        "origin": origin,
        "file": src_file,
        "ref": src_ref,
    }
    if src_raw.get("duplicatesMerged"):
        merged = [collapse_inline_ws(str(x)) for x in src_raw["duplicatesMerged"] if str(x).strip()]
        if merged:
            source["duplicatesMerged"] = list(dict.fromkeys(merged))
    if src_raw.get("note"):
        note = collapse_inline_ws(str(src_raw["note"]))
        if note:
            source["note"] = note

    out: dict[str, Any] = {
        "id": q_id,
        "type": q_type,
        "chapter": chapter,
    }

    if raw.get("sectionId"):
        sec_id = collapse_inline_ws(str(raw["sectionId"]))
        if sec_id:
            out["sectionId"] = sec_id

    out["stem"] = stem

    ans_raw = raw.get("answer")
    if q_type in ("choice", "multi"):
        opts_raw = raw.get("options")
        if not isinstance(opts_raw, list) or len(opts_raw) < 2:
            raise ValueError(f"[{source_filename}] Missing/too-short options in id={q_id!r}")
        options = [clean_option(str(o)) for o in opts_raw]
        if any(not o for o in options):
            raise ValueError(f"[{source_filename}] Empty option in id={q_id!r}")
        out["options"] = options

        if q_type == "choice":
            if isinstance(ans_raw, bool) or not isinstance(ans_raw, int):
                raise ValueError(f"[{source_filename}] choice answer must be int in id={q_id!r}, got {ans_raw!r}")
            if not (0 <= ans_raw < len(options)):
                raise ValueError(f"[{source_filename}] choice answer out of range in id={q_id!r}: {ans_raw}")
            out["answer"] = ans_raw
        else:
            if not isinstance(ans_raw, list) or len(ans_raw) < 2:
                raise ValueError(f"[{source_filename}] multi answer must be list with >=2 items in id={q_id!r}")
            cleaned_indices: list[int] = []
            for idx in ans_raw:
                if isinstance(idx, bool) or not isinstance(idx, int):
                    raise ValueError(f"[{source_filename}] multi answer index must be int in id={q_id!r}: {idx!r}")
                if not (0 <= idx < len(options)):
                    raise ValueError(f"[{source_filename}] multi answer index out of range in id={q_id!r}: {idx}")
                cleaned_indices.append(idx)
            sorted_unique = sorted(set(cleaned_indices))
            if len(sorted_unique) < 2:
                raise ValueError(f"[{source_filename}] multi answer needs >=2 unique indices in id={q_id!r}")
            out["answer"] = sorted_unique
    elif q_type == "tf":
        if not isinstance(ans_raw, bool):
            raise ValueError(f"[{source_filename}] tf answer must be bool in id={q_id!r}, got {ans_raw!r}")
        out["answer"] = ans_raw
    else:
        if not isinstance(ans_raw, str) or not ans_raw.strip():
            raise ValueError(f"[{source_filename}] {q_type} answer must be non-empty string in id={q_id!r}")
        out["answer"] = normalize_multiline(ans_raw)

    explain_raw = raw.get("explain")
    if not isinstance(explain_raw, str) or not explain_raw.strip():
        raise ValueError(f"[{source_filename}] Empty explain in id={q_id!r}")
    out["explain"] = normalize_multiline(explain_raw)

    kp_raw = raw.get("keyPoints")
    if isinstance(kp_raw, list):
        kps = [collapse_inline_ws(str(x)) for x in kp_raw if str(x).strip()]
        if kps:
            out["keyPoints"] = kps

    tags_raw = raw.get("tags")
    if isinstance(tags_raw, list):
        tags = [collapse_inline_ws(str(x)) for x in tags_raw if str(x).strip()]
        if tags:
            out["tags"] = list(dict.fromkeys(tags))

    out["source"] = source
    return out


def option_overlap_ratio(opts_a: list[str] | None, opts_b: list[str] | None) -> float:
    if not opts_a or not opts_b:
        return 0.0
    set_a = {dedup_key(o) for o in opts_a if dedup_key(o)}
    set_b = {dedup_key(o) for o in opts_b if dedup_key(o)}
    if not set_a or not set_b:
        return 0.0
    matched = 0
    for a in set_a:
        if a in set_b:
            matched += 1
        elif any(difflib.SequenceMatcher(None, a, b).ratio() >= 0.85 for b in set_b):
            matched += 1
    return matched / max(len(set_a), len(set_b))


def is_duplicate(existing: dict[str, Any], candidate: dict[str, Any]) -> tuple[bool, str]:
    """Return (True, reason) if candidate duplicates existing."""
    key_a = dedup_key(existing["stem"])
    key_b = dedup_key(candidate["stem"])

    if key_a == key_b:
        # Identical normalized stem
        return True, "exact_normalized_stem"

    if stem_exact_key(existing["stem"]) == stem_exact_key(candidate["stem"]):
        return True, "exact_stem"

    # Only perform fuzzy matching within compatible types
    same_type = existing["type"] == candidate["type"]
    both_select = existing["type"] in ("choice", "multi") and candidate["type"] in ("choice", "multi")
    if not (same_type or both_select):
        return False, ""

    # Quick length ratio filter for speed
    len_a, len_b = len(key_a), len(key_b)
    if min(len_a, len_b) / max(len_a, len_b, 1) < 0.78:
        return False, ""

    sim = difflib.SequenceMatcher(None, key_a, key_b).ratio()

    if both_select:
        opt_ov = option_overlap_ratio(existing.get("options"), candidate.get("options"))
        if sim >= 0.86 and opt_ov >= 0.60:
            return True, f"fuzzy_stem+options(sim={sim:.2f},opt={opt_ov:.2f})"
        if sim >= 0.94 and opt_ov >= 0.40:
            return True, f"high_fuzzy_stem(sim={sim:.2f},opt={opt_ov:.2f})"
        return False, ""

    if existing["type"] == "tf":
        if sim >= 0.93 and existing["answer"] == candidate["answer"]:
            return True, f"fuzzy_tf(sim={sim:.2f})"
        return False, ""

    # short / analysis
    if sim >= 0.92 and existing["chapter"] == candidate["chapter"]:
        return True, f"fuzzy_subjective(sim={sim:.2f})"

    return False, ""


def format_merge_ref(q: dict[str, Any]) -> str:
    src = q["source"]
    return f"{src['origin']}:{src['ref']} ({q['id']})"


def load_chapters_from_notes(notes_path: Path) -> list[dict[str, Any]]:
    notes = json.loads(notes_path.read_text(encoding="utf-8"))
    chapters: list[dict[str, Any]] = []
    for ch in notes.get("chapters", []):
        entry: dict[str, Any] = {
            "id": int(ch["id"]),
            "short": collapse_inline_ws(str(ch["short"])),
            "title": collapse_inline_ws(str(ch["title"])),
        }
        if ch.get("overview"):
            entry["description"] = collapse_inline_ws(str(ch["overview"]))
        chapters.append(entry)
    chapters.sort(key=lambda c: c["id"])
    if [c["id"] for c in chapters] != list(range(1, 10)):
        raise ValueError(f"Expected chapters 1..9 in notes.json, got {[c['id'] for c in chapters]}")
    return chapters


def build_bank(allow_missing: bool = False, output_path: Path | None = None) -> dict[str, Any]:
    notes_path = DATA_DIR / "notes.json"
    if not notes_path.exists():
        raise FileNotFoundError(f"Missing required notes file: {notes_path}")
    chapters = load_chapters_from_notes(notes_path)

    loaded_batches: list[tuple[int, str, list[dict[str, Any]]]] = []
    for filename, default_origin, priority in RAW_SOURCES:
        candidates = [d / filename for d in FALLBACK_RAW_DIRS if (d / filename).exists()]
        path = max(candidates, key=lambda p: p.stat().st_mtime) if candidates else (SCRIPTS_DIR / filename)
        if not path.exists():
            if allow_missing:
                print(f"[WARN] Skipping missing raw file: {path}", file=sys.stderr)
                continue
            raise FileNotFoundError(f"Missing required raw file: {path}")
        raw_text = path.read_text(encoding="utf-8")
        # Mirror into scripts/ so repo retains complete reproducible corpus sources
        canonical = SCRIPTS_DIR / filename
        if path.resolve() != canonical.resolve():
            canonical.write_text(raw_text, encoding="utf-8")
            print(f"[SYNC] Copied {path} -> {canonical}")
        raw_items = json.loads(raw_text)
        if not isinstance(raw_items, list):
            raise ValueError(f"{path} must contain a JSON array")
        normalized = [normalize_question(item, default_origin, filename) for item in raw_items]
        loaded_batches.append((priority, filename, normalized))
        print(f"[LOAD] {filename}: {len(normalized)} questions (origin={default_origin})")

    # Process in strict priority order: comprehensive_bank -> video_popup -> review_notes_synthesized
    loaded_batches.sort(key=lambda b: b[0])

    kept: list[dict[str, Any]] = []
    merged_log: list[str] = []
    seen_ids: set[str] = set()

    for _priority, filename, batch in loaded_batches:
        for cand in batch:
            matched_idx: int | None = None
            matched_reason = ""
            for idx, existing in enumerate(kept):
                dup, reason = is_duplicate(existing, cand)
                if dup:
                    matched_idx = idx
                    matched_reason = reason
                    break

            if matched_idx is not None:
                primary = kept[matched_idx]
                merged_list = list(primary["source"].get("duplicatesMerged", []))
                ref_str = format_merge_ref(cand)
                if ref_str not in merged_list:
                    merged_list.append(ref_str)
                primary["source"]["duplicatesMerged"] = merged_list

                # Inherit sectionId if primary lacked one and duplicate is same chapter
                if not primary.get("sectionId") and cand.get("sectionId") and primary["chapter"] == cand["chapter"]:
                    primary["sectionId"] = cand["sectionId"]

                # Enrich explanation if primary explanation was very brief
                if len(primary["explain"]) < 15 and len(cand["explain"]) > len(primary["explain"]):
                    primary["explain"] = cand["explain"]

                merged_log.append(
                    f"  MERGE [{matched_reason}]: {cand['id']} ({cand['source']['origin']}) -> {primary['id']} ({primary['source']['origin']})"
                )
                continue

            # Guarantee globally unique stable ID
            orig_id = cand["id"]
            if orig_id in seen_ids:
                suffix = 2
                while f"{orig_id}-dup{suffix}" in seen_ids:
                    suffix += 1
                new_id = f"{orig_id}-dup{suffix}"
                print(f"[WARN] Duplicate ID {orig_id!r} in {filename}; renamed to {new_id!r}", file=sys.stderr)
                cand["id"] = new_id
            seen_ids.add(cand["id"])
            kept.append(cand)

    # Sort deterministically by chapter, type, origin, id
    kept.sort(
        key=lambda q: (
            q["chapter"],
            TYPE_ORDER[q["type"]],
            ORIGIN_ORDER[q["source"]["origin"]],
            q["id"],
        )
    )

    by_type = {t: 0 for t in VALID_TYPES}
    by_origin = {o: 0 for o in VALID_ORIGINS}
    for q in kept:
        by_type[q["type"]] += 1
        by_origin[q["source"]["origin"]] += 1

    bank: dict[str, Any] = {
        "meta": {
            "title": "人工智能导论 · 全量期末刷题题库",
            "version": "1.0.0",
            "generatedAt": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
            "counts": {
                "total": len(kept),
                "byType": by_type,
                "byOrigin": by_origin,
            },
        },
        "chapters": chapters,
        "questions": kept,
    }

    dest = output_path or (DATA_DIR / "bank.json")
    dest.parent.mkdir(parents=True, exist_ok=True)
    dest.write_text(json.dumps(bank, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

    print(f"\n[DEDUP] Merged {len(merged_log)} duplicate question(s):")
    for line in merged_log:
        print(line)

    ch_counts = Counter(q["chapter"] for q in kept)
    print(f"\n[DONE] Wrote {dest} ({len(kept)} questions)")
    print(f"  byType:   {by_type}")
    print(f"  byOrigin: {by_origin}")
    print(f"  byChapter: {dict(sorted(ch_counts.items()))}")
    return bank


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Build src/data/bank.json from raw question JSON sources.")
    parser.add_argument(
        "--allow-missing",
        action="store_true",
        help="Allow missing raw_*.json files (for partial dry runs only).",
    )
    parser.add_argument(
        "-o",
        "--output",
        type=Path,
        default=None,
        help="Optional custom output path (defaults to src/data/bank.json).",
    )
    args = parser.parse_args(argv)
    build_bank(allow_missing=args.allow_missing, output_path=args.output)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
