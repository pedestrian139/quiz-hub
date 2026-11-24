"""Export PDF pages as PNG images with lossless embedded extraction or DPI rendering.

Supports page range filtering, lossless single-image extraction (with auto fallback
to PyMuPDF pixmap rendering), optional dark-card cropping, directory cleaning,
and JSON manifest output.
"""

from __future__ import annotations

import argparse
import io
import json
import re
import sys
from pathlib import Path
from typing import Any

import pymupdf
from PIL import Image

_TOKEN_RANGE_RE = re.compile(r"^(\d+)(?:-(\d+))?$")


def parse_pages_spec(spec: str, page_count: int) -> list[int]:
    """Parse a comma/range page specification like '1-4,38,73-74' into sorted 1-based page numbers."""
    if not spec or not spec.strip():
        raise ValueError("Empty --pages specification.")

    pages: set[int] = set()
    for raw_token in spec.split(","):
        token = raw_token.strip()
        if not token:
            raise ValueError(f"Empty token in --pages specification: {spec!r}")
        match = _TOKEN_RANGE_RE.match(token)
        if not match:
            raise ValueError(f"Invalid page token {token!r} in --pages specification.")
        start = int(match.group(1))
        end = int(match.group(2)) if match.group(2) is not None else start
        if start < 1 or end > page_count or start > end:
            raise ValueError(
                f"Page range {token!r} out of bounds for PDF with {page_count} pages."
            )
        pages.update(range(start, end + 1))

    if not pages:
        raise ValueError("No pages selected.")
    return sorted(pages)


def resolve_page_numbers(
    page_count: int,
    pages_spec: str | None,
    start: int | None,
    end: int | None,
) -> list[int]:
    """Resolve and validate 1-based page numbers from CLI arguments."""
    if page_count <= 0:
        raise ValueError("PDF contains 0 pages.")

    if pages_spec is not None:
        return parse_pages_spec(pages_spec, page_count)

    s = 1 if start is None else start
    e = page_count if end is None else end
    if s < 1 or e > page_count or s > e:
        raise ValueError(
            f"Invalid page range --start {s} --end {e} for PDF with {page_count} pages."
        )
    return list(range(s, e + 1))


def can_extract_full_page_embedded(page: pymupdf.Page) -> tuple[bool, int | None, str]:
    """Check whether a page contains exactly one unrotated full-page (>=95%) embedded image."""
    if page.rotation != 0:
        return False, None, f"page rotation is {page.rotation}"

    imgs = page.get_images(full=True)
    if len(imgs) != 1:
        return False, None, f"expected 1 image, found {len(imgs)}"

    infos = page.get_image_info()
    if len(infos) != 1:
        return False, None, f"expected 1 image info entry, found {len(infos)}"

    info = infos[0]
    rect = page.rect
    if rect.width <= 0 or rect.height <= 0:
        return False, None, "invalid page rect dimensions"

    bx0, by0, bx1, by1 = info["bbox"]
    cov_w = (bx1 - bx0) / rect.width
    cov_h = (by1 - by0) / rect.height
    if cov_w < 0.95 or cov_h < 0.95:
        return (
            False,
            None,
            f"image bbox covers {cov_w:.1%}x{cov_h:.1%} (<95% threshold)",
        )

    t = info["transform"]
    if abs(t[1]) > 1e-6 or abs(t[2]) > 1e-6 or t[0] <= 0 or t[3] <= 0:
        return False, None, f"image transform is rotated/sheared/flipped: {t}"

    xref = int(imgs[0][0])
    return True, xref, "ok"


def crop_dark_card(
    img: Image.Image,
    dark_threshold: int,
    crop_pad: int,
) -> tuple[Image.Image, bool, list[int] | None]:
    """Crop image around pixels darker than dark_threshold, padded by crop_pad."""
    rgb = img if img.mode == "RGB" else img.convert("RGB")
    gray = rgb.convert("L")
    mask = gray.point(lambda v: 255 if v < dark_threshold else 0)
    bbox = mask.getbbox()
    if bbox is None:
        return rgb, False, None

    box_w = bbox[2] - bbox[0]
    box_h = bbox[3] - bbox[1]
    if box_w < 200 or box_h < 100:
        return rgb, False, None

    w, h = rgb.size
    x0 = max(0, bbox[0] - crop_pad)
    y0 = max(0, bbox[1] - crop_pad)
    x1 = min(w, bbox[2] + crop_pad)
    y1 = min(h, bbox[3] + crop_pad)
    cropped = rgb.crop((x0, y0, x1, y1))
    return cropped, True, [x0, y0, x1, y1]


def export_pages(args: argparse.Namespace) -> dict[str, Any]:
    """Run PDF page export and return manifest dictionary."""
    pdf_path: Path = args.pdf_path
    out_dir: Path = args.out_dir

    if not pdf_path.exists() or not pdf_path.is_file():
        raise FileNotFoundError(f"PDF file not found: {pdf_path}")

    if args.dark_threshold < 0 or args.dark_threshold > 255:
        raise ValueError(f"--dark-threshold must be in 0..255, got {args.dark_threshold}")
    if args.crop_pad < 0:
        raise ValueError(f"--crop-pad must be >= 0, got {args.crop_pad}")
    if not args.prefix or "/" in args.prefix or "\\" in args.prefix:
        raise ValueError(f"Invalid --prefix: {args.prefix!r}")

    if args.extract_embedded:
        mode = "embedded"
        dpi = 150
    elif args.dpi is not None:
        if args.dpi <= 0:
            raise ValueError(f"--dpi must be > 0, got {args.dpi}")
        mode = "render"
        dpi = args.dpi
    else:
        mode = "auto"
        dpi = 150

    out_dir.mkdir(parents=True, exist_ok=True)
    if args.clean:
        for png_file in out_dir.glob("*.png"):
            png_file.unlink()
        default_manifest = out_dir / "manifest.json"
        if default_manifest.exists():
            default_manifest.unlink()

    doc = pymupdf.open(str(pdf_path))
    try:
        page_count = len(doc)
        selected_pages = resolve_page_numbers(
            page_count=page_count,
            pages_spec=args.pages,
            start=args.start,
            end=args.end,
        )

        page_records: list[dict[str, Any]] = []
        for page_num in selected_pages:
            page = doc[page_num - 1]
            out_file = out_dir / f"{args.prefix}_p{page_num:03d}.png"

            use_embedded = False
            xref: int | None = None
            if mode in ("embedded", "auto"):
                ok, xref, reason = can_extract_full_page_embedded(page)
                if ok and xref is not None:
                    use_embedded = True
                elif mode == "embedded":
                    raise RuntimeError(
                        f"Cannot extract embedded image on page {page_num}: {reason}"
                    )

            cropped = False
            crop_bbox: list[int] | None = None

            if use_embedded and xref is not None:
                extracted = doc.extract_image(xref)
                raw_bytes: bytes = extracted["image"]
                ext = str(extracted.get("ext", "")).lower()
                source = "embedded"

                if ext == "png" and not args.crop_dark_card:
                    out_file.write_bytes(raw_bytes)
                    width = int(extracted["width"])
                    height = int(extracted["height"])
                else:
                    with Image.open(io.BytesIO(raw_bytes)) as opened:
                        img = opened if opened.mode == "RGB" else opened.convert("RGB")
                        if args.crop_dark_card:
                            img, cropped, crop_bbox = crop_dark_card(
                                img, args.dark_threshold, args.crop_pad
                            )
                        width, height = img.size
                        img.save(out_file, format="PNG", optimize=False)
            else:
                pix = page.get_pixmap(dpi=dpi, alpha=False)
                source = "render"
                if not args.crop_dark_card:
                    pix.save(str(out_file))
                    width, height = pix.width, pix.height
                else:
                    img = Image.frombytes("RGB", (pix.width, pix.height), pix.samples)
                    img, cropped, crop_bbox = crop_dark_card(
                        img, args.dark_threshold, args.crop_pad
                    )
                    width, height = img.size
                    img.save(out_file, format="PNG", optimize=False)

            page_records.append(
                {
                    "page": page_num,
                    "file": str(out_file.resolve()),
                    "width": width,
                    "height": height,
                    "source": source,
                    "cropped": cropped,
                    "crop_bbox": crop_bbox,
                }
            )
    finally:
        doc.close()

    manifest: dict[str, Any] = {
        "pdf_path": str(pdf_path.resolve()),
        "page_count": page_count,
        "exported_count": len(page_records),
        "mode": mode,
        "cropped_dark_card": bool(args.crop_dark_card),
        "pages": page_records,
    }
    if mode != "embedded":
        manifest["dpi"] = dpi

    if args.json_manifest is not None:
        manifest_path = (
            out_dir / "manifest.json"
            if args.json_manifest == "__DEFAULT__"
            else Path(args.json_manifest)
        )
        manifest_path.parent.mkdir(parents=True, exist_ok=True)
        manifest_path.write_text(
            json.dumps(manifest, ensure_ascii=False, indent=2) + "\n",
            encoding="utf-8",
        )

    return manifest


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Export PDF pages to PNG images using PyMuPDF and Pillow."
    )
    parser.add_argument("pdf_path", type=Path, help="Input PDF file path.")
    parser.add_argument(
        "-o",
        "--out-dir",
        type=Path,
        required=True,
        help="Output directory for exported PNG files.",
    )
    parser.add_argument(
        "--start",
        type=int,
        default=None,
        help="1-based inclusive start page.",
    )
    parser.add_argument(
        "--end",
        type=int,
        default=None,
        help="1-based inclusive end page.",
    )
    parser.add_argument(
        "--pages",
        type=str,
        default=None,
        help="Comma/range page list (e.g. '1-4,38,73-74'); mutually exclusive with --start/--end.",
    )

    mode_group = parser.add_mutually_exclusive_group()
    mode_group.add_argument(
        "--extract-embedded",
        action="store_true",
        help="Force extracting the single embedded image per page.",
    )
    mode_group.add_argument(
        "--dpi",
        type=int,
        default=None,
        help="Render DPI (default: 150 in auto fallback; passing --dpi forces render mode).",
    )

    parser.add_argument(
        "--crop-dark-card",
        action="store_true",
        help="Crop dark-card region (gray < --dark-threshold) with padding.",
    )
    parser.add_argument(
        "--dark-threshold",
        type=int,
        default=100,
        help="Grayscale threshold (0..255) for dark-card detection (default: 100).",
    )
    parser.add_argument(
        "--crop-pad",
        type=int,
        default=16,
        help="Padding in pixels around detected dark-card bbox (default: 16).",
    )
    parser.add_argument(
        "--prefix",
        type=str,
        default="page",
        help="Output filename prefix (default: 'page').",
    )
    parser.add_argument(
        "--clean",
        action="store_true",
        help="Delete existing *.png and manifest.json in --out-dir before exporting.",
    )
    parser.add_argument(
        "--json-manifest",
        nargs="?",
        const="__DEFAULT__",
        default=None,
        help="Write JSON manifest (default: <out-dir>/manifest.json) and print compact JSON summary.",
    )
    return parser


def main(argv: list[str] | None = None) -> int:
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")
    if hasattr(sys.stderr, "reconfigure"):
        sys.stderr.reconfigure(encoding="utf-8")

    parser = build_parser()
    args = parser.parse_args(argv)

    if args.pages is not None and (args.start is not None or args.end is not None):
        parser.error("--pages is mutually exclusive with --start and --end.")

    try:
        manifest = export_pages(args)
    except Exception as exc:
        print(f"Error: {exc}", file=sys.stderr)
        return 1

    if args.json_manifest is not None:
        print(json.dumps(manifest, ensure_ascii=False, separators=(",", ":")))
    else:
        print(
            f"Exported {manifest['exported_count']} page(s) from {manifest['pdf_path']} "
            f"(mode={manifest['mode']}) -> {args.out_dir}"
        )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
