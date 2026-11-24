"""Strict schema, quality, coverage, and E2E-invariant auditor for src/data/bank.json.

Exits with code 0 only when EVERY rule passes; exits with code 1 on any violation.
"""

from __future__ import annotations

import argparse
import json
import re
import sys
from collections import Counter, defaultdict
from pathlib import Path
from typing import Any

REPO_ROOT = Path(__file__).resolve().parent.parent
DATA_DIR = REPO_ROOT / "src" / "data"

VALID_TYPES = ("choice", "multi", "tf", "short", "analysis")
VALID_ORIGINS = ("comprehensive_bank", "video_popup", "review_notes_synthesized")

_LEADING_NUM_RE = re.compile(
    r"^\s*(?:[\(（]\s*\d{1,3}\s*[\)）]|\d{1,3}\s*[\.\、\)\）]|第\s*\d{1,3}\s*题[\s:：\.、]*)"
)
_OPTION_PREFIX_RE = re.compile(r"^\s*[A-Ha-h]\s*[\.\、\)\）:：]\s*")
_CONTROL_CHAR_RE = re.compile(r"[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]")
_BAD_TOKENS_RE = re.compile(r"(?:\bundefined\b|\bNaN\b|\ufffd|\bTODO\b|\bFIXME\b|\bTBD\b|\[待补\]|\[待完善\])")


def iter_strings(obj: Any, path: str = "$") -> list[tuple[str, str]]:
    found: list[tuple[str, str]] = []
    if isinstance(obj, str):
        found.append((path, obj))
    elif isinstance(obj, list):
        for i, item in enumerate(obj):
            found.extend(iter_strings(item, f"{path}[{i}]"))
    elif isinstance(obj, dict):
        for k, v in obj.items():
            found.extend(iter_strings(v, f"{path}.{k}"))
    return found


def norm_ws(s: str) -> str:
    return re.sub(r"\s+", " ", s).strip()


def audit_bank(bank_path: Path, notes_path: Path, allow_partial: bool = False) -> int:
    errors: list[str] = []
    warnings: list[str] = []

    if not notes_path.exists():
        print(f"[FATAL] notes.json not found: {notes_path}", file=sys.stderr)
        return 1
    if not bank_path.exists():
        print(f"[FATAL] bank.json not found: {bank_path}", file=sys.stderr)
        return 1

    notes = json.loads(notes_path.read_text(encoding="utf-8"))
    bank = json.loads(bank_path.read_text(encoding="utf-8"))

    # 1. Build authoritative notes section map
    notes_chapters = notes.get("chapters", [])
    expected_chapters: dict[int, dict[str, Any]] = {}
    valid_section_chapter: dict[str, int] = {}
    for ch in notes_chapters:
        cid = int(ch["id"])
        expected_chapters[cid] = {
            "id": cid,
            "short": ch["short"],
            "title": ch["title"],
        }
        for sec in ch.get("sections", []):
            valid_section_chapter[sec["id"]] = cid

    all_section_ids = sorted(
        valid_section_chapter.keys(),
        key=lambda sid: tuple(int(x) for x in re.findall(r"\d+", sid)),
    )

    # 2. Top-level structure
    for key in ("meta", "chapters", "questions"):
        if key not in bank:
            errors.append(f"Missing top-level key: {key!r}")

    meta = bank.get("meta", {})
    chapters = bank.get("chapters", [])
    questions = bank.get("questions", [])

    if not isinstance(chapters, list) or len(chapters) != 9:
        errors.append(f"bank.chapters must have 9 entries, got {len(chapters) if isinstance(chapters, list) else type(chapters)}")
    else:
        for ch in chapters:
            cid = ch.get("id")
            if cid not in expected_chapters:
                errors.append(f"Unexpected chapter id in bank.chapters: {cid!r}")
                continue
            exp = expected_chapters[cid]
            if ch.get("short") != exp["short"] or ch.get("title") != exp["title"]:
                errors.append(
                    f"Chapter {cid} metadata mismatch: got ({ch.get('short')!r}, {ch.get('title')!r}) "
                    f"expected ({exp['short']!r}, {exp['title']!r})"
                )

    if not isinstance(questions, list):
        errors.append("bank.questions must be a JSON array")
        questions = []

    # 3. Per-question validation & statistics
    seen_ids: set[str] = set()
    seen_stems: dict[str, str] = {}
    by_type: Counter[str] = Counter()
    by_origin: Counter[str] = Counter()
    by_chapter: Counter[int] = Counter()
    ch_origin: dict[int, Counter[str]] = defaultdict(Counter)
    ch_type: dict[int, Counter[str]] = defaultdict(Counter)
    tf_counts: Counter[bool] = Counter()
    sec_all: Counter[str] = Counter()
    sec_syn: Counter[str] = Counter()
    subj_with_kp = 0
    subj_without_kp = 0
    merged_total = 0
    choice_answer_dist: Counter[int] = Counter()

    for idx, q in enumerate(questions):
        prefix = f"questions[{idx}]"
        if not isinstance(q, dict):
            errors.append(f"{prefix}: entry is not an object")
            continue

        q_id = q.get("id")
        if not isinstance(q_id, str) or not q_id.strip():
            errors.append(f"{prefix}: missing/invalid id")
            q_id = f"<missing-{idx}>"
        elif q_id in seen_ids:
            errors.append(f"{prefix}: duplicate id {q_id!r}")
        else:
            seen_ids.add(q_id)

        q_type = q.get("type")
        if q_type not in VALID_TYPES:
            errors.append(f"{q_id}: invalid type {q_type!r}")
            continue
        by_type[q_type] += 1

        chapter = q.get("chapter")
        if isinstance(chapter, bool) or not isinstance(chapter, int) or not (1 <= chapter <= 9):
            errors.append(f"{q_id}: invalid chapter {chapter!r}")
            continue
        by_chapter[chapter] += 1
        ch_type[chapter][q_type] += 1

        sec_id = q.get("sectionId")
        if sec_id is not None:
            if not isinstance(sec_id, str) or sec_id not in valid_section_chapter:
                errors.append(f"{q_id}: invalid sectionId {sec_id!r} (not in notes.json)")
            elif valid_section_chapter[sec_id] != chapter:
                errors.append(
                    f"{q_id}: sectionId {sec_id!r} belongs to chapter {valid_section_chapter[sec_id]}, "
                    f"not chapter {chapter}"
                )
            else:
                sec_all[sec_id] += 1

        stem = q.get("stem")
        if not isinstance(stem, str) or len(stem.strip()) < 4:
            errors.append(f"{q_id}: empty or too-short stem")
        else:
            if _LEADING_NUM_RE.match(stem):
                errors.append(f"{q_id}: stem still has leading question number: {stem[:30]!r}")
            snorm = norm_ws(stem)
            if snorm in seen_stems:
                errors.append(f"{q_id}: duplicate stem with {seen_stems[snorm]}: {snorm[:50]!r}")
            else:
                seen_stems[snorm] = q_id

        ans = q.get("answer")
        opts = q.get("options")

        if q_type in ("choice", "multi"):
            if not isinstance(opts, list) or len(opts) < 2:
                errors.append(f"{q_id}: {q_type} requires options list (len>=2)")
            else:
                if q_type == "choice" and len(opts) != 4:
                    warnings.append(f"{q_id}: choice has {len(opts)} options (expected 4)")
                if q_type == "multi" and len(opts) < 4:
                    warnings.append(f"{q_id}: multi has {len(opts)} options (expected 4-5)")
                seen_opt_texts: set[str] = set()
                for oi, opt in enumerate(opts):
                    if not isinstance(opt, str) or not opt.strip():
                        errors.append(f"{q_id}: empty option at index {oi}")
                        continue
                    if _OPTION_PREFIX_RE.match(opt):
                        errors.append(f"{q_id}: option[{oi}] has letter prefix: {opt[:25]!r}")
                    onorm = norm_ws(opt)
                    if onorm in seen_opt_texts:
                        errors.append(f"{q_id}: duplicate option text {onorm!r}")
                    seen_opt_texts.add(onorm)

                if q_type == "choice":
                    if isinstance(ans, bool) or not isinstance(ans, int):
                        errors.append(f"{q_id}: choice answer must be int, got {ans!r}")
                    elif not (0 <= ans < len(opts)):
                        errors.append(f"{q_id}: choice answer {ans} out of bounds [0, {len(opts)-1}]")
                    else:
                        choice_answer_dist[ans] += 1
                else:
                    if not isinstance(ans, list) or len(ans) < 2:
                        errors.append(f"{q_id}: multi answer must be int[] with len>=2, got {ans!r}")
                    else:
                        bad_item = any(isinstance(x, bool) or not isinstance(x, int) for x in ans)
                        if bad_item:
                            errors.append(f"{q_id}: multi answer contains non-int: {ans!r}")
                        else:
                            if ans != sorted(set(ans)):
                                errors.append(f"{q_id}: multi answer must be strictly sorted unique ints: {ans!r}")
                            if any(not (0 <= x < len(opts)) for x in ans):
                                errors.append(f"{q_id}: multi answer index out of range [0, {len(opts)-1}]: {ans!r}")
        else:
            if opts is not None:
                errors.append(f"{q_id}: {q_type} must not have options field")
            if q_type == "tf":
                if not isinstance(ans, bool):
                    errors.append(f"{q_id}: tf answer must be bool, got {ans!r}")
                else:
                    tf_counts[ans] += 1
            else:
                if not isinstance(ans, str) or len(ans.strip()) < 10:
                    errors.append(f"{q_id}: {q_type} answer must be detailed string (len>=10)")

        explain = q.get("explain")
        if not isinstance(explain, str) or len(explain.strip()) < 5:
            errors.append(f"{q_id}: missing or too-short explain")

        if "keyPoints" in q:
            kp = q["keyPoints"]
            if not isinstance(kp, list) or len(kp) == 0 or any(not isinstance(x, str) or not x.strip() for x in kp):
                errors.append(f"{q_id}: keyPoints must be non-empty string[] when present")
            elif q_type in ("short", "analysis"):
                subj_with_kp += 1
        elif q_type in ("short", "analysis"):
            subj_without_kp += 1

        src = q.get("source")
        if not isinstance(src, dict):
            errors.append(f"{q_id}: missing/invalid source object")
        else:
            origin = src.get("origin")
            if origin not in VALID_ORIGINS:
                errors.append(f"{q_id}: invalid source.origin {origin!r}")
            else:
                by_origin[origin] += 1
                ch_origin[chapter][origin] += 1
                if origin == "review_notes_synthesized" and isinstance(sec_id, str) and sec_id in valid_section_chapter:
                    sec_syn[sec_id] += 1
            if not isinstance(src.get("file"), str) or not src["file"].strip():
                errors.append(f"{q_id}: missing source.file")
            if not isinstance(src.get("ref"), str) or not src["ref"].strip():
                errors.append(f"{q_id}: missing source.ref")
            if "duplicatesMerged" in src:
                dm = src["duplicatesMerged"]
                if not isinstance(dm, list) or any(not isinstance(x, str) or not x.strip() for x in dm):
                    errors.append(f"{q_id}: invalid source.duplicatesMerged")
                else:
                    merged_total += len(dm)

        # Bad tokens / mojibake / control char scan
        for field_path, text in iter_strings(q, q_id):
            if _CONTROL_CHAR_RE.search(text):
                errors.append(f"{field_path}: contains illegal control character")
            bad = _BAD_TOKENS_RE.search(text)
            if bad:
                errors.append(f"{field_path}: contains forbidden token {bad.group(0)!r}")

    # 4. Meta counts accuracy
    counts = meta.get("counts", {})
    if counts.get("total") != len(questions):
        errors.append(f"meta.counts.total={counts.get('total')} != len(questions)={len(questions)}")
    for t in VALID_TYPES:
        if counts.get("byType", {}).get(t) != by_type[t]:
            errors.append(f"meta.counts.byType[{t!r}]={counts.get('byType', {}).get(t)} != actual {by_type[t]}")
    for o in VALID_ORIGINS:
        if counts.get("byOrigin", {}).get(o) != by_origin[o]:
            errors.append(f"meta.counts.byOrigin[{o!r}]={counts.get('byOrigin', {}).get(o)} != actual {by_origin[o]}")

    # 5. Global coverage & E2E invariant checks
    if not allow_partial:
        if len(questions) <= 190:
            errors.append(f"Total question count {len(questions)} must be > 190")
        for t in VALID_TYPES:
            if by_type[t] <= 0:
                errors.append(f"Question type {t!r} count is 0 (must be > 0)")
        for o in VALID_ORIGINS:
            if by_origin[o] <= 0:
                errors.append(f"Question origin {o!r} count is 0 (must be > 0)")

        # Balanced TF true/false
        tf_total = tf_counts[True] + tf_counts[False]
        if tf_total == 0 or tf_counts[True] == 0 or tf_counts[False] == 0:
            errors.append(f"TF answers must include both true and false: {dict(tf_counts)}")
        else:
            true_ratio = tf_counts[True] / tf_total
            if not (0.25 <= true_ratio <= 0.75):
                errors.append(
                    f"TF answer ratio imbalanced: true={tf_counts[True]}, false={tf_counts[False]} ({true_ratio:.1%})"
                )

        # Subjective keyPoints coverage (both with & without for T1-058 and T2-060)
        if subj_with_kp == 0:
            errors.append("Must have subjective questions WITH keyPoints (for T1-058)")
        if subj_without_kp == 0:
            errors.append("Must have subjective questions WITHOUT keyPoints (for T2-060)")

        # E2E specific invariants
        if ch_origin[2]["video_popup"] < 1:
            errors.append("E2E invariant failed: Chapter 2 must have >= 1 video_popup question")

        comp_tf_ch2 = sum(
            1 for q in questions
            if q.get("chapter") == 2 and q.get("type") == "tf" and q.get("source", {}).get("origin") == "comprehensive_bank"
        )
        comp_tf_ch3 = sum(
            1 for q in questions
            if q.get("chapter") == 3 and q.get("type") == "tf" and q.get("source", {}).get("origin") == "comprehensive_bank"
        )
        if comp_tf_ch2 < 1:
            errors.append("E2E invariant failed: Chapter 2 must have >= 1 comprehensive_bank tf question")
        if comp_tf_ch3 < 1:
            errors.append("E2E invariant failed: Chapter 3 must have >= 1 comprehensive_bank tf question")

        if ch_type[1]["tf"] < 2:
            errors.append(f"E2E invariant failed: Chapter 1 must have >= 2 tf questions, got {ch_type[1]['tf']}")
        if ch_type[4]["tf"] < 2:
            errors.append(f"E2E invariant failed: Chapter 4 must have >= 2 tf questions, got {ch_type[4]['tf']}")
        if ch_type[7]["tf"] < 1:
            errors.append(f"E2E invariant failed: Chapter 7 must have >= 1 tf question, got {ch_type[7]['tf']}")

        if ch_origin[1]["review_notes_synthesized"] < 1:
            errors.append("E2E invariant failed: Chapter 1 must have >= 1 review_notes_synthesized question")
        if ch_origin[1]["comprehensive_bank"] < 1:
            errors.append("E2E invariant failed: Chapter 1 must have >= 1 comprehensive_bank question")

        ch1_subj = ch_type[1]["analysis"] if ch_type[1]["analysis"] > 0 else ch_type[1]["short"]
        if not (0 < ch1_subj < 30):
            errors.append(f"E2E invariant T2-018 failed: Chapter 1 analysis/short count={ch1_subj} must be in (0, 30)")

        for cid in range(1, 10):
            if by_chapter[cid] < 5:
                errors.append(f"Chapter {cid} has too few questions: {by_chapter[cid]} (< 5)")

    # All 64 sections coverage check (always enforced!)
    missing_sec_all = [sid for sid in all_section_ids if sec_all[sid] == 0]
    missing_sec_syn = [sid for sid in all_section_ids if sec_syn[sid] == 0]
    if missing_sec_all:
        errors.append(f"Uncovered notes.json sections ({len(missing_sec_all)}): {missing_sec_all}")
    if missing_sec_syn:
        errors.append(f"notes.json sections missing synthesized questions ({len(missing_sec_syn)}): {missing_sec_syn}")

    # 6. Print Coverage Report
    print("=" * 72)
    print(f"BANK AUDIT REPORT: {bank_path}")
    print("=" * 72)
    print(f"Total questions     : {len(questions)}")
    print(f"By type             : { {t: by_type[t] for t in VALID_TYPES} }")
    print(f"By origin           : { {o: by_origin[o] for o in VALID_ORIGINS} }")
    print(f"TF balance          : true={tf_counts[True]}, false={tf_counts[False]}")
    print(f"Choice answer dist  : {dict(sorted(choice_answer_dist.items()))}")
    print(f"Subjective keyPoints: with={subj_with_kp}, without={subj_without_kp}")
    print(f"Merged duplicates   : {merged_total}")
    print(f"Section coverage    : {len(all_section_ids) - len(missing_sec_all)}/{len(all_section_ids)} (all), "
          f"{len(all_section_ids) - len(missing_sec_syn)}/{len(all_section_ids)} (synthesized)")

    print("\nChapter x Origin matrix:")
    print(f"  {'Ch':<4} {'Total':>6} {'comp':>6} {'vid':>6} {'syn':>6}")
    for cid in range(1, 10):
        print(
            f"  Ch{cid:<2} {by_chapter[cid]:>6} "
            f"{ch_origin[cid]['comprehensive_bank']:>6} "
            f"{ch_origin[cid]['video_popup']:>6} "
            f"{ch_origin[cid]['review_notes_synthesized']:>6}"
        )

    print("\nChapter x Type matrix:")
    print(f"  {'Ch':<4} {'Total':>6} {'choice':>7} {'multi':>6} {'tf':>5} {'short':>6} {'anal':>6}")
    for cid in range(1, 10):
        print(
            f"  Ch{cid:<2} {by_chapter[cid]:>6} "
            f"{ch_type[cid]['choice']:>7} "
            f"{ch_type[cid]['multi']:>6} "
            f"{ch_type[cid]['tf']:>5} "
            f"{ch_type[cid]['short']:>6} "
            f"{ch_type[cid]['analysis']:>6}"
        )

    if warnings:
        print(f"\nWarnings ({len(warnings)}):")
        for w in warnings:
            print(f"  [WARN] {w}")

    if errors:
        print(f"\nFAILED with {len(errors)} error(s):")
        for e in errors:
            print(f"  [FAIL] {e}")
        return 1

    print("\n[PASS] All schema, quality, coverage, and E2E invariant checks passed!")
    return 0


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Audit src/data/bank.json against schema and coverage rules.")
    parser.add_argument(
        "--bank",
        type=Path,
        default=DATA_DIR / "bank.json",
        help="Path to bank.json (defaults to src/data/bank.json).",
    )
    parser.add_argument(
        "--notes",
        type=Path,
        default=DATA_DIR / "notes.json",
        help="Path to notes.json (defaults to src/data/notes.json).",
    )
    parser.add_argument(
        "--allow-partial",
        action="store_true",
        help="Skip multi-origin / total>190 checks (for auditing synthesized-only dry runs).",
    )
    args = parser.parse_args(argv)
    return audit_bank(args.bank, args.notes, allow_partial=args.allow_partial)


if __name__ == "__main__":
    raise SystemExit(main())
