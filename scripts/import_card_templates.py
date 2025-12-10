"""
Usage: python import_card_templates.py path/to/cards.csv
Reads the provided CSV and inserts into backend DB.
"""
import csv
import sys
import time
from pathlib import Path

from sqlmodel import Session, SQLModel, create_engine

sys.path.append(str(Path(__file__).resolve().parents[1] / "backend"))
from main import CardTemplate, auth_settings  # type: ignore


def main(csv_path: str):
    engine = create_engine(auth_settings.database_url)
    SQLModel.metadata.create_all(engine)
    rows = []
    with open(csv_path, newline="", encoding="utf-8") as f:
        reader = csv.DictReader(f)
        for r in reader:
            rows.append(r)
    with Session(engine) as session:
        for r in rows:
            template_raw = r.get("template_id") or r.get("token_id") or r.get("Number")
            if not template_raw:
                continue
            template_id = int(template_raw)
            idx_raw = r.get("index") or template_id
            name = r.get("card_name") or r.get("name") or r.get("Name") or ""
            rarity = r.get("rarity") or r.get("Rarity") or "Common"
            image_url = (
                r.get("image_url")
                or r.get("Image URL")
                or r.get("image")
                or r.get("Image")
            )
            serial_number = (
                r.get("serial_number")
                or r.get("card_number")
                or r.get("cardNumber")
                or r.get("Number")
                or r.get("token_id")
                or r.get("tokenId")
            )
            template = CardTemplate(
                template_id=template_id,
                index=int(idx_raw),
                card_name=name,
                rarity=rarity,
                variant=r.get("variant"),
                set_code=r.get("set_code"),
                set_name=r.get("set_name"),
                serial_number=serial_number,
                is_energy=str(r.get("is_energy", "false")).lower() in ["true", "1", "yes"],
                energy_type=r.get("energy_type"),
                image_url=image_url,
            )
            session.merge(template)
        session.commit()
    print(f"Imported {len(rows)} templates @ {time.time()}")


if __name__ == "__main__":
    if len(sys.argv) < 2:
        print(__doc__)
        sys.exit(1)
    main(sys.argv[1])
