"""
Generate placeholder MintRecords for each template (simulate Metaplex Core mints).
Real flow should mint Core assets via Metaplex Core CPI or JS SDK and then write the resulting asset ids here.
"""
import csv
import sys
import uuid
from pathlib import Path

from sqlmodel import Session, SQLModel, create_engine

sys.path.append(str(Path(__file__).resolve().parents[1] / "backend"))
from main import CardTemplate, MintRecord, auth_settings  # type: ignore


def main(csv_path: str):
    engine = create_engine(auth_settings.database_url)
    SQLModel.metadata.create_all(engine)
    with open(csv_path, newline="", encoding="utf-8") as f:
        reader = csv.DictReader(f)
        templates = list(reader)
    with Session(engine) as session:
        for row in templates:
            template_id = int(row["template_id"])
            rarity = row.get("rarity", "Common")
            fake_asset = str(uuid.uuid4())
            record = MintRecord(
                asset_id=fake_asset,
                template_id=template_id,
                rarity=rarity,
                status="available",
            )
            session.merge(record)
        session.commit()
    print(f"Inserted {len(templates)} placeholder MintRecords")


if __name__ == "__main__":
    if len(sys.argv) < 2:
        print(__doc__)
        sys.exit(1)
    main(sys.argv[1])
