#!/usr/bin/env python3
"""
Headless price fetcher for TCGPlayer using Scrapy + Playwright (adapted from pokespider).

- Reads config (set IDs/names) from env/config file.
- Runs spider, normalizes rows, inserts into Mochi DB PriceSnapshot table.

Note: Playwright must be installed with Chromium: `playwright install chromium`.
"""
"""
Headless price fetcher for TCGPlayer using Scrapy + Playwright (adapted from pokespider).

Usage:
  - Configure sets in price_oracle/config.json ("sets": ["Base Set", ...]).
  - Install playwright browsers: `playwright install chromium`.
  - Run: `python3 scripts/fetch_tcg_prices.py`

This will crawl (currently mock mode) and insert rows into PriceSnapshot.
Replace the mock spider mode with a real Playwright/Scrapy implementation inside price_oracle/pokespider.
"""
import os
import sys
import json
import time
from datetime import datetime
import difflib
import subprocess
from decimal import Decimal
from typing import List
from playwright.sync_api import sync_playwright
import requests
from urllib.parse import urlencode

from sqlmodel import Session, select
from sqlalchemy.exc import SQLAlchemyError

sys.path.append(os.path.abspath(os.path.join(os.path.dirname(__file__), '..')))
from backend.main import engine  # noqa: E402
from backend.main import PriceSnapshot, CardTemplate  # noqa: E402


DEFAULT_CONFIG_PATH = os.environ.get("PRICE_ORACLE_CONFIG", "price_oracle/config.json")


def load_config(path: str) -> List[str]:
    if not os.path.exists(path):
        return []
    with open(path, "r", encoding="utf-8") as fh:
        data = json.load(fh)
    if not isinstance(data, dict):
        return []
    # support either "sets" or "set_ids"
    if "set_ids" in data and isinstance(data["set_ids"], list):
        return data["set_ids"]
    return data.get("sets", []) if isinstance(data.get("sets"), list) else []

def run_playwright_priceguide(sets: List[str]) -> List[dict]:
    """Scrape TCGplayer price guide pages directly (avoids CF-heavy search grid).
       Returns list of dicts with set_name, card_name, low/market/mid (mapped to mid), high."""
    results = []
    if not sets:
        return results
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        page = browser.new_page(user_agent="Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119 Safari/537.36")
        for s in sets:
            slug = s.lower().replace(" ", "-")
            url = f"https://www.tcgplayer.com/categories/trading-and-collectible-card-games/pokemon/price-guides/{slug}"
            try:
                page.goto(url, wait_until="domcontentloaded", timeout=30000)
                page.wait_for_selector("table tbody tr", timeout=15000)
                rows = page.locator("table tbody tr")
                for i in range(rows.count()):
                    row = rows.nth(i)
                    name = row.locator("td").nth(0).inner_text().strip()
                    low = row.locator("td").nth(2).inner_text().strip().replace("$","") or "0"
                    mid = row.locator("td").nth(3).inner_text().strip().replace("$","") or "0"
                    high = row.locator("td").nth(4).inner_text().strip().replace("$","") or mid
                    results.append({
                        "set_name": s,
                        "card_name": name,
                        "low_price": low,
                        "mid_price": mid,
                        "high_price": high,
                    })
            except Exception as exc:  # noqa: BLE001
                print(f"Playwright scrape failed for {url}: {exc}")
                continue
        browser.close()
    return results


def run_scrapy_spider(sets: List[str]) -> List[dict]:
    try:
        # Try pokemonTCG.io API first (needs POKEMONTCG_API_KEY); returns TCGplayer prices without scraping.
        api_rows = run_pokemontcg_api(sets)
        if api_rows:
            return api_rows

        # Try Playwright price-guide scrape first; fallback to scrapy spider if needed.
        rows = run_playwright_priceguide(sets)
        if rows:
            return rows

        from importlib import import_module
        from scrapy.crawler import CrawlerProcess
        from scrapy.settings import Settings
        from price_oracle.pokespider.pokespider.spiders.main_spider import MainSpider
        from price_oracle.pokespider.pokespider.pipelines import COLLECTED_ITEMS

        COLLECTED_ITEMS.clear()
        items: List[dict] = COLLECTED_ITEMS

        scrapy_settings = Settings()
        try:
            mod = import_module("price_oracle.pokespider.pokespider.settings")
            scrapy_settings.setmodule(mod, priority="project")
        except ModuleNotFoundError:
            pass

        # override pipelines and set selection
        scrapy_settings.set(
            "ITEM_PIPELINES",
            {"price_oracle.pokespider.pokespider.pipelines.CollectItemsPipeline": 100},
        )
        scrapy_settings.set("ITEM_BUCKET", items)
        scrapy_settings.set("LOG_ENABLED", True)
        scrapy_settings.set("USE_SET_SELECTION_WINDOW", False)
        scrapy_settings.set("DEFAULT_SET_LIST", sets)

        process = CrawlerProcess(settings=scrapy_settings)
        process.crawl(MainSpider)
        process.start()
        return items
    except Exception as exc:  # noqa: BLE001
        print(f"Scrapy run failed, falling back to mock rows: {exc}")
        rows = []
        now = time.time()
        for s in sets:
            rows.append(
                {
                    "set_name": s,
                    "card_name": f"Sample {s}",
                    "mid_price": "12.34",
                    "low_price": "10.00",
                    "high_price": "15.00",
                    "template_id": None,
                    "collected_at": now,
                }
            )
        return rows


def run_pokemontcg_api(sets: List[str]) -> List[dict]:
    """Fetch prices via pokemonTCG.io (TCGplayer prices) using an API key."""
    api_key = os.environ.get("POKEMONTCG_API_KEY")
    if not api_key or not sets:
        return []
    # cache all sets once so we can map names -> ids reliably
    set_catalog = fetch_set_catalog(api_key)

    headers = {
        "Accept": "application/json",
        "X-Api-Key": api_key,
    }
    results: List[dict] = []
    for s in sets:
        url = "https://api.pokemontcg.io/v2/cards"
        page = 1
        set_id = None
        if set_catalog:
            # direct id match or name match (case-insensitive)
            key = s.lower()
            set_id = set_catalog.get(key) or set_catalog.get(s.upper())
        # allow passing explicit set id (e.g., "me1") to bypass catalog lookups
        if not set_id and s and " " not in s and len(s) <= 5:
            set_id = s.lower()
        page_size = 50  # smaller pages avoid API 504s
        while True:
            q_val = f"set.id:{set_id}" if set_id else f'set.name:\"{s}\"'
            q_encoded = urlencode({"q": q_val})
            url_with_query = (
                f"{url}?{q_encoded}&page={page}&pageSize={page_size}"
                "&select=name,set,tcgplayer,rarity"
            )
            try:
                data = fetch_json_with_curl(api_key, url_with_query)
                cards = data.get("data", []) if data else []
                if not cards:
                    break
                for card in cards:
                    name = card.get("name")
                    set_info = (card.get("set") or {}).get("name", s)
                    prices = (card.get("tcgplayer") or {}).get("prices") or {}
                    price_entry = None
                    for entry in prices.values():
                        if isinstance(entry, dict):
                            price_entry = entry
                            break
                    if not price_entry:
                        continue
                    mid = price_entry.get("mid") or price_entry.get("market") or price_entry.get("average") or 0
                    low = price_entry.get("low") or mid
                    high = price_entry.get("high") or mid
                    market = price_entry.get("market") or price_entry.get("mid") or 0
                    results.append(
                        {
                            "set_name": set_info,
                            "card_name": name,
                            "mid_price": mid,
                            "low_price": low,
                            "high_price": high,
                            "market_price": market,
                        }
                    )
                if len(cards) < page_size:
                    break
                page += 1
            except Exception as exc:  # noqa: BLE001
                print(f"pokemonTCG.io fetch failed for set '{s}' (page {page}): {exc}")
                break
    return results


def fetch_set_catalog(api_key: str) -> dict:
    """Return mapping of lowercased set name and id to set.id for lookup."""
    url = "https://api.pokemontcg.io/v2/sets"
    page = 1
    page_size = 100
    catalog = {}
    try:
        while True:
            url_with_query = f"{url}?{urlencode({'page': page, 'pageSize': page_size})}"
            data = fetch_json_with_curl(api_key, url_with_query)
            sets = data.get("data", []) if data else []
            if not sets:
                break
            for s in sets:
                sid = s.get("id")
                name = (s.get("name") or "").lower()
                if sid:
                    catalog[sid.lower()] = sid
                if name:
                    catalog[name] = sid
            if len(sets) < page_size:
                break
            page += 1
        print(f"Fetched {len(catalog)} set identifiers for catalog lookup.")
    except Exception as exc:  # noqa: BLE001
        print(f"Could not fetch set catalog: {exc}")
    return catalog


def fetch_json_with_curl(api_key: str, url: str, timeout: int = 120) -> dict:
    """Use curl (http/1.1) to bypass occasional python-requests 504/404 from Cloudflare."""
    proxy = os.environ.get("POKEMONTCG_PROXY")  # e.g. http://user:pass@host:port
    cmd = [
        "curl",
        "--http1.1",
        "-s",
        "--max-time",
        str(timeout),
        "-H",
        "Accept: application/json",
        "-H",
        f"X-Api-Key: {api_key}",
        "-w",
        "\nHTTP_CODE:%{http_code}",
        url,
    ]
    if proxy:
        cmd.insert(1, "-x")
        cmd.insert(2, proxy)
    try:
        proc = subprocess.run(cmd, check=False, capture_output=True, text=True)
        if proc.returncode != 0:
            print(f"curl failed ({proc.returncode}) for {url}: {proc.stderr}")
            return {}
        raw = proc.stdout or ""
        body, _, status_line = raw.rpartition("HTTP_CODE:")
        status = status_line.strip() if status_line else ""
        body = body.strip()
        if status and status != "200":
            print(f"curl http {status} for {url}")
        if not body:
            print(f"curl returned empty body for {url} (code {proc.returncode}, http {status})")
            return {}
        try:
            return json.loads(body)
        except Exception as exc:  # noqa: BLE001
            snippet = body[:200].replace("\n", " ")
            print(f"curl json parse error for {url}: {exc}. body[:200]={snippet}")
            return {}
    except Exception as exc:  # noqa: BLE001
        print(f"curl json fetch failed for {url}: {exc}")
        return {}


def find_template_id(card_name: str, set_name: str, templates: List[CardTemplate]) -> int:
    """Very simple name matcher: exact, then best fuzzy match with ratio >=0.75."""
    target = (card_name or "").strip().lower()
    target_set = (set_name or "").strip().lower()
    if not target:
        return None
    # exact
    for tmpl in templates:
        if tmpl.card_name.strip().lower() == target:
            return tmpl.template_id
    # fuzzy
    best_id = None
    best_ratio = 0.0
    for tmpl in templates:
        name_norm = tmpl.card_name.strip().lower()
        ratio = difflib.SequenceMatcher(None, target, name_norm).ratio()
        # small boost if set matches (if provided)
        if target_set and tmpl.set_name and tmpl.set_name.strip().lower() == target_set:
            ratio += 0.05
        if ratio > best_ratio and ratio >= 0.75:
            best_ratio = ratio
            best_id = tmpl.template_id
    return best_id


def insert_snapshots(rows: List[dict]):
    now = datetime.utcnow()
    with Session(engine) as session:
        templates = session.exec(select(CardTemplate)).all()
        inserted = 0
        for row in rows:
            name = row.get("card_name") or row.get("name", "")
            set_name = row.get("card_series") or row.get("set_name", "")
            market = row.get("market_price") or row.get("market") or row.get("mid_price") or row.get("median_price") or 0
            mid = row.get("mid_price") or row.get("median_price") or market or 0
            low = row.get("direct_low") or row.get("low_price") or mid
            high = row.get("high_price") or row.get("foil_high_price") or mid
            template_id = row.get("template_id") or find_template_id(name, set_name, templates)
            if not template_id:
                continue
            direct_low = row.get("direct_low") or low
            snap = PriceSnapshot(
                template_id=template_id,
                source="pokespider_tcgplayer",
                currency="USD",
                market_price=Decimal(str(market)),
                direct_low=Decimal(str(direct_low)),
                mid_price=Decimal(str(mid)),
                low_price=Decimal(str(low)),
                high_price=Decimal(str(high)),
                collected_at=float(row.get("collected_at", time.time())) if row.get("collected_at") else now.timestamp(),
            )
            session.add(snap)
            inserted += 1
        try:
            session.commit()
        except SQLAlchemyError as exc:  # noqa: BLE001
            session.rollback()
            print(f"DB insert failed: {exc}", file=sys.stderr)
            raise
    print(f"Inserted {inserted} snapshots (from {len(rows)} scraped items).")


def main():
    sets = load_config(DEFAULT_CONFIG_PATH)
    if not sets:
        print("No sets configured. Provide price_oracle/config.json with a 'sets' array.")
        return
    rows = run_scrapy_spider(sets)
    insert_snapshots(rows)
    print(f"Inserted {len(rows)} snapshots.")


if __name__ == "__main__":
    main()
