"""
Generate placeholder MintRecords for a pack from CSV.
- Skips Common/Uncommon supply (virtual-only).
- Rares/Double/Ultra/Illustration/Promo => 6 copies each.
- Special Illustration / Mega Hyper => 1 copy each.

Usage: python mint_core_from_csv.py path/to/phantasmal_flames.csv [pack_id]
"""
import csv as csv_module
import sys
import uuid
from pathlib import Path
from typing import Dict, Optional

from sqlalchemy import func
from sqlmodel import Session, SQLModel, create_engine, select

sys.path.append(str(Path(__file__).resolve().parents[1] / "backend"))
from main import CardTemplate, MintRecord, auth_settings  # type: ignore  # noqa: E402

PACK_TEMPLATE_OFFSETS = {"meg_web": 0, "phantasmal_flames": 2000}
PACK_NAMES = {"meg_web": "Mega Evolution", "phantasmal_flames": "Phantasmal Flames"}


def normalize_rarity(value: str) -> str:
    return (value or "").replace(" ", "").replace("_", "").lower()


def supply_for_rarity(rarity: str) -> int:
    key = normalize_rarity(rarity)
    if key in {"common", "uncommon"}:
        return 0
    if key in {"specialillustrationrare", "megahyperrare"}:
        return 1
    # Rare, DoubleRare, UltraRare, IllustrationRare, Promo
    return 6


def parse_template_id(row: dict, idx: int, pack_id: str) -> int:
    token = row.get("template_id") or row.get("token_id") or row.get("Number") or row.get("serial_number")
    offset = PACK_TEMPLATE_OFFSETS.get(pack_id, 0)
    if token:
        try:
            base_id = int(str(token).split("/")[0])
            return offset + base_id
        except Exception:
            pass
    return offset + idx + 1


def main(csv_path: str, pack_id: str = "meg_web"):
    engine = create_engine(auth_settings.database_url)
    SQLModel.metadata.create_all(engine)
    with open(csv_path, newline="", encoding="utf-8") as f:
        reader = csv_module.DictReader(f)
        templates = list(reader)

    created_records = 0
    touched_templates = 0
    minted_by_rarity: Dict[str, int] = {}
    templates_by_rarity: Dict[str, int] = {}
    set_name = PACK_NAMES.get(pack_id, pack_id)
    offset = PACK_TEMPLATE_OFFSETS.get(pack_id, 0)

    with Session(engine) as session:
        for idx, row in enumerate(templates):
            template_id = parse_template_id(row, idx, pack_id)
            name = row.get("card_name") or row.get("name") or row.get("Name") or f"Card {template_id}"
            rarity = row.get("rarity") or row.get("Rarity") or "Common"
            variant = row.get("variant") or row.get("Variant") or row.get("holo_type")
            image_url = row.get("image_url") or row.get("Image URL") or row.get("image") or row.get("Image")
            tmpl = CardTemplate(
                template_id=template_id,
                index=idx + 1,
                card_name=name,
                rarity=rarity,
                variant=variant,
                set_code=pack_id,
                set_name=set_name,
                is_energy=str(row.get("is_energy", "false")).lower() in ["true", "1", "yes"],
                energy_type=row.get("energy_type"),
                image_url=image_url,
            )
            session.merge(tmpl)
            touched_templates += 1
            templates_by_rarity[rarity] = templates_by_rarity.get(rarity, 0) + 1

            supply = supply_for_rarity(rarity)
            if supply <= 0:
                continue
            existing_count = (
                session.exec(select(func.count()).where(MintRecord.template_id == template_id)).first() or 0
            )
            missing = max(0, supply - existing_count)
            for _ in range(missing):
                fake_asset = str(uuid.uuid4())
                record = MintRecord(
                    asset_id=fake_asset,
                    template_id=template_id,
                    rarity=rarity,
                    status="available",
                )
                session.add(record)
                created_records += 1
                minted_by_rarity[rarity] = minted_by_rarity.get(rarity, 0) + 1
        session.commit()
    print(
        f"Pack '{pack_id}' (offset {offset}) → templ={touched_templates}, new_records={created_records}, csv={csv_path}"
    )
    if templates_by_rarity:
        print("Templates by rarity:", templates_by_rarity)
    if minted_by_rarity:
        print("MintRecords created by rarity:", minted_by_rarity)
    else:
        print("MintRecords created by rarity: none (virtual-only rows)")


if __name__ == "__main__":
    if len(sys.argv) < 2:
        print(__doc__)
        sys.exit(1)
    csv_path_arg = sys.argv[1]
    pack = sys.argv[2] if len(sys.argv) > 2 else "meg_web"
    main(csv_path_arg, pack)
