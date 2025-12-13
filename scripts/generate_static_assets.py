"""
Generate static images + metadata JSON for a set.

Inputs:
- CSV with template rows (must include a numeric token_id / template_id / Number / serial_number column)
- Source image directory containing card art

Outputs:
- static/img/{set_slug}/{template_id}.jpg
- static/nft/metadata/{set_slug}/{template_id}.json

Usage:
  python3 scripts/generate_static_assets.py \\
    --set-code meg_web \\
    --set-slug mega-evolutions \\
    --csv frontend/public/data/mega_evolutions.csv \\
    --image-dir frontend/public/img/meg_web \\
    --asset-base-url https://getmochi.fun
"""
from __future__ import annotations

import argparse
import csv
import json
import re
import sys
from dataclasses import dataclass
from pathlib import Path
from typing import Dict, List, Optional, Tuple

try:
    from PIL import Image
except Exception:  # noqa: BLE001
    Image = None  # type: ignore[assignment]


ROOT_DIR = Path(__file__).resolve().parents[1]
DEFAULT_ASSET_HOST = "https://getmochi.fun"
DEFAULT_PLACEHOLDER = ROOT_DIR / "frontend" / "public" / "card_back.png"

# Legacy Mega energies live outside the CSV; map their template_ids to filenames.
MEGA_ENERGY_IMAGES: Dict[int, str] = {
    189: "energy_grass.png",
    190: "energy_fire.png",
    191: "energy_water.png",
    192: "energy_lightning.png",
    193: "energy_psychic.png",
    194: "energy_fighting.png",
    195: "energy_darkness.png",
    196: "energy_metal.png",
}


@dataclass
class TemplateRow:
    template_id: int
    base_id: int
    collector_number: str
    name: str
    rarity: str
    finish: str
    printing_flags: str
    language_tag: str
    set_code: str
    set_slug: str
    image_hint: Optional[str] = None


def ensure_pillow():
    if Image is None:
        raise SystemExit("Pillow is required. Install with: python3 -m pip install --user pillow")


def safe_template_str(template_id: int) -> str:
    return str(template_id).zfill(3)


def normalize_rarity(value: str) -> str:
    base = re.sub(r"[^a-z]", "", value.lower())
    mapping = {
        "doublerare": "double_rare",
        "ultrarare": "ultra_rare",
        "illustrationrare": "illustration_rare",
        "specialillustrationrare": "special_illustration_rare",
        "megahyperrare": "hyper_rare",
        "hyperrare": "hyper_rare",
    }
    return mapping.get(base, base or "common")


def normalize_finish(raw: str) -> str:
    lowered = raw.lower()
    if "reverse" in lowered:
        return "reverse_holo"
    if "etched" in lowered:
        return "etched_holo"
    if "galaxy" in lowered:
        return "galaxy_holo"
    if "cracked" in lowered:
        return "cracked_ice_holo"
    if "cosmos" in lowered:
        return "cosmos_holo"
    if "holo" in lowered or "foil" in lowered:
        return "holo"
    return "non_holo"


def normalize_printing_flags(raw: Optional[str]) -> str:
    if not raw:
        return "-"
    tokens = [t.strip().lower() for t in re.split(r"[+,/]", raw) if t.strip()]
    if not tokens:
        return "-"
    tokens = sorted(set(tokens))
    return "+".join(tokens)


def parse_template_row(row: dict, idx: int, args) -> TemplateRow:
    token = (
        row.get("template_id")
        or row.get("token_id")
        or row.get("Number")
        or row.get("serial_number")
        or row.get("card_number")
    )
    base_id = idx + 1
    if token:
        try:
            numeric = str(token).split("/")[0]
            base_id = int(numeric)
        except Exception:
            base_id = idx + 1
    template_id = args.offset + base_id
    collector_number = (
        row.get("serial_number")
        or row.get("card_number")
        or row.get("token_id")
        or row.get("Number")
        or safe_template_str(base_id)
    )
    name = (row.get("card_name") or row.get("name") or row.get("Name") or f"Card {template_id}").strip()
    rarity = normalize_rarity(row.get("rarity") or row.get("Rarity") or "common")
    finish_raw = row.get("variant") or row.get("Variant") or row.get("holo_type") or ""
    finish = normalize_finish(finish_raw)
    printing_flags = normalize_printing_flags(row.get("printing_flags") or row.get("flags"))
    language_tag = (row.get("language_tag") or args.language or "en").strip()
    image_hint = row.get("image_url") or row.get("Image URL") or row.get("image") or row.get("Image")

    return TemplateRow(
        template_id=template_id,
        base_id=base_id,
        collector_number=str(collector_number),
        name=name,
        rarity=rarity,
        finish=finish,
        printing_flags=printing_flags,
        language_tag=language_tag,
        set_code=args.set_code,
        set_slug=args.set_slug,
        image_hint=image_hint,
    )


def collect_templates(args) -> Dict[int, TemplateRow]:
    rows: Dict[int, TemplateRow] = {}
    csv_path = ROOT_DIR / args.csv
    with csv_path.open(newline="", encoding="utf-8") as fh:
        reader = csv.DictReader(fh)
        for idx, raw in enumerate(reader):
            tmpl = parse_template_row(raw, idx, args)
            # Keep the first occurrence if duplicates are present.
            if tmpl.template_id not in rows:
                rows[tmpl.template_id] = tmpl
    # Add energy templates for Mega Evolutions if missing from CSV.
    if args.set_slug in {"mega-evolutions", "meg_web", "mega_evolutions"}:
        for tid, filename in MEGA_ENERGY_IMAGES.items():
            if tid in rows:
                continue
            rows[tid] = TemplateRow(
                template_id=tid,
                base_id=tid,
                collector_number=str(tid),
                name="Energy",
                rarity="energy",
                finish="non_holo",
                printing_flags="-",
                language_tag=args.language or "en",
                set_code=args.set_code,
                set_slug=args.set_slug,
                image_hint=filename,
            )
    return rows


def find_source_image(tmpl: TemplateRow, image_dir: Path, placeholder: Path) -> Path:
    # Energy files have custom names.
    if tmpl.template_id in MEGA_ENERGY_IMAGES:
        candidate = image_dir / MEGA_ENERGY_IMAGES[tmpl.template_id]
        if candidate.exists():
            return candidate
    if tmpl.image_hint:
        hint_name = Path(str(tmpl.image_hint)).name
        candidate = image_dir / hint_name
        if candidate.exists():
            return candidate
    padded = safe_template_str(tmpl.base_id)
    # Look for files by collector number prefix.
    for pattern in [
        f"{padded}.jpg",
        f"{padded}.jpeg",
        f"{padded}.png",
        f"{padded}-*.jpg",
        f"{padded}-*.jpeg",
        f"{padded}-*.png",
        f"{padded}_*.jpg",
        f"{padded}_*.jpeg",
        f"{padded}_*.png",
    ]:
        for candidate in image_dir.glob(pattern):
            return candidate
    # Fallback: any file that starts with the template id.
    template_str = safe_template_str(tmpl.template_id)
    for pattern in [f"{template_str}.jpg", f"{template_str}.png", f"{template_str}_*.png", f"{template_str}-*.png"]:
        for candidate in image_dir.glob(pattern):
            return candidate
    return placeholder


def convert_to_jpeg(src: Path, dest: Path):
    dest.parent.mkdir(parents=True, exist_ok=True)
    if src.suffix.lower() in {".jpg", ".jpeg"}:
        dest.write_bytes(src.read_bytes())
        return
    img = Image.open(src)
    if img.mode in ("RGBA", "LA"):
        background = Image.new("RGB", img.size, (255, 255, 255))
        background.paste(img, mask=img.split()[-1])
        img = background
    else:
        img = img.convert("RGB")
    img.save(dest, format="JPEG", quality=95)


def build_metadata(tmpl: TemplateRow, image_url: str) -> dict:
    name = f"{tmpl.name} #{safe_template_str(tmpl.template_id)}"
    description = f"{tmpl.set_code} template {tmpl.collector_number}".strip()
    attrs = [
        {"trait_type": "template_id", "value": tmpl.template_id},
        {"trait_type": "set_code", "value": tmpl.set_code},
        {"trait_type": "collector_number", "value": tmpl.collector_number},
        {"trait_type": "rarity_norm", "value": tmpl.rarity},
        {"trait_type": "finish", "value": tmpl.finish},
        {"trait_type": "printing_flags", "value": tmpl.printing_flags or "-"},
        {"trait_type": "language_tag", "value": tmpl.language_tag},
    ]
    return {
        "name": name,
        "description": description,
        "image": image_url,
        "category": "image",
        "attributes": attrs,
        "properties": {
            "files": [
                {"uri": image_url, "type": "image/jpeg"},
            ],
        },
    }


def write_metadata_file(dest: Path, data: dict):
    dest.parent.mkdir(parents=True, exist_ok=True)
    dest.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def process(args):
    ensure_pillow()
    templates = collect_templates(args)
    image_dir = ROOT_DIR / args.image_dir
    placeholder = Path(args.placeholder)
    if not placeholder.is_absolute():
        placeholder = ROOT_DIR / placeholder
    if not image_dir.exists():
        raise SystemExit(f"Image directory not found: {image_dir}")
    if not placeholder.exists():
        raise SystemExit(f"Placeholder image not found: {placeholder}")

    image_count = 0
    metadata_count = 0
    missing_images: List[int] = []

    for tmpl_id in sorted(templates.keys()):
        tmpl = templates[tmpl_id]
        src_image = find_source_image(tmpl, image_dir, placeholder)
        if not src_image.exists():
            missing_images.append(tmpl.template_id)
            src_image = placeholder
        img_out = ROOT_DIR / args.static_root / "img" / tmpl.set_slug / f"{safe_template_str(tmpl.template_id)}.jpg"
        convert_to_jpeg(src_image, img_out)
        image_count += 1

        image_url = f"{args.asset_base_url.rstrip('/')}/img/{tmpl.set_slug}/{safe_template_str(tmpl.template_id)}.jpg"
        meta_out = (
            ROOT_DIR
            / args.static_root
            / "nft"
            / "metadata"
            / tmpl.set_slug
            / f"{safe_template_str(tmpl.template_id)}.json"
        )
        write_metadata_file(meta_out, build_metadata(tmpl, image_url))
        metadata_count += 1

    print(f"Generated {image_count} images and {metadata_count} metadata files for set '{args.set_slug}'.")
    if missing_images:
        print(f"Warning: {len(missing_images)} templates used the placeholder image: {sorted(missing_images)[:10]}{'...' if len(missing_images) > 10 else ''}")


def parse_args(argv: Optional[List[str]] = None):
    parser = argparse.ArgumentParser(description="Generate static images + metadata for a set.")
    parser.add_argument("--set-code", required=True, dest="set_code", help="Canonical set_code for the set (e.g., meg_web)")
    parser.add_argument("--set-slug", required=True, dest="set_slug", help="URL slug (e.g., mega-evolutions or phantasmal_flames)")
    parser.add_argument("--csv", required=True, dest="csv", help="Path to the source CSV (relative to repo root)")
    parser.add_argument("--image-dir", required=True, dest="image_dir", help="Directory containing source images")
    parser.add_argument("--static-root", default="static", dest="static_root", help="Output root for static files")
    parser.add_argument("--offset", type=int, default=0, help="Template ID offset to add to CSV base ids")
    parser.add_argument("--language", default="en", help="Language tag to stamp into metadata when missing")
    parser.add_argument("--asset-base-url", default=DEFAULT_ASSET_HOST, dest="asset_base_url", help="Public base URL for assets (default: https://getmochi.fun)")
    parser.add_argument("--placeholder", default=str(DEFAULT_PLACEHOLDER), help="Path to placeholder image for missing art")
    return parser.parse_args(argv)


if __name__ == "__main__":
    arguments = parse_args()
    process(arguments)
