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
            template = CardTemplate(
                template_id=int(r["template_id"]),
                index=int(r.get("index", 0)),
                card_name=r.get("card_name") or r.get("name", ""),
                rarity=r.get("rarity", "Common"),
                variant=r.get("variant"),
                set_code=r.get("set_code"),
                set_name=r.get("set_name"),
                is_energy=r.get("is_energy", "false").lower() in ["true", "1", "yes"],
                energy_type=r.get("energy_type"),
                image_url=r.get("image_url"),
            )
            session.merge(template)
        session.commit()
    print(f"Imported {len(rows)} templates @ {time.time()}")


if __name__ == "__main__":
    if len(sys.argv) < 2:
        print(__doc__)
        sys.exit(1)
    main(sys.argv[1])
