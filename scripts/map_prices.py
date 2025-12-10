#!/usr/bin/env python3
"""
Map existing CardTemplate rows to PokemonPriceTracker tcgPlayerId values using strict rarity-aware matching.

- Loads CardTemplate rows (optionally filtered by set_code) as the source of truth for name + rarity + serial.
- Builds structured searches: "{collection_name} {card_serial} {pokemon_name}" with a `rarity` filter.
- Searches the /api/v2/cards endpoint using the structured term, then filters results by rarity/set/serial.
- Skips mappings that don't match rarity or would obviously be wrong (e.g., Common mapped to a $40 card).

This script is idempotent: it will skip rows that already have tcgplayer_id unless --force is provided.
Respectful rate limiting is applied between lookups.
"""

import argparse
import json
import os
import re
import sys
import time
from pathlib import Path
from typing import Dict, List, Optional, Tuple

import requests
from sqlmodel import Session, select

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
if ROOT not in sys.path:
    sys.path.append(ROOT)

from backend.main import PACK_REGISTRY, CardPriceMapping, CardTemplate, engine, init_db  # noqa: E402


API_BASE = os.environ.get("POKEMON_PRICE_TRACKER_BASE_URL", "https://www.pokemonpricetracker.com/api/v2")
API_KEY = (
    os.environ.get("POKEMON_PRICE_TRACKER_API_KEY")
    or os.environ.get("POKEMON_PRICE_API_KEY")
    or os.environ.get("POKEMON_PRICE_TRACKER_BEARER")
)

RARITY_CAP_COMMON = 10.0
RARITY_NORMALIZATION = {
    "double rare": "doublerare",
    "double_rare": "doublerare",
    "double-rare": "doublerare",
    "illustration rare": "illustrationrare",
    "special illustration rare": "specialillustrationrare",
    "mega hyper rare": "megahyperrare",
}
VARIANT_NORMALIZATION = {
    "reverse holo": "reverse_holo",
    "reverse_holo": "reverse_holo",
    "reverseholo": "reverse_holo",
    "holofoil": "holo",
    "holo foil": "holo",
    "foil": "holo",
    "holo": "holo",
    "non-holo": "normal",
    "non holo": "normal",
    "normal": "normal",
}


def normalize_text(value: Optional[str]) -> str:
    return re.sub(r"\s+", " ", str(value or "")).strip().lower()


def normalize_set_name(value: Optional[str]) -> str:
    if not value:
        return ""
    raw = str(value)
    if ":" in raw:
        raw = raw.split(":", 1)[1]
    raw = raw.replace("_", " ")
    return normalize_text(raw)


def normalized_rarity(value: Optional[str]) -> str:
    base = normalize_text(value).replace(" ", "").replace("_", "").replace("-", "")
    return RARITY_NORMALIZATION.get(base, base)


def rarity_filter_value(value: Optional[str]) -> Optional[str]:
    """
    Convert internal rarity labels into API-friendly query strings.
    """
    if not value:
        return None
    norm = normalized_rarity(value)
    pretty_map = {
        "doublerare": "Double Rare",
        "illustrationrare": "Illustration Rare",
        "specialillustrationrare": "Special Illustration Rare",
        "megahyperrare": "Hyper Rare",
    }
    if norm in pretty_map:
        return pretty_map[norm]
    raw = str(value)
    spaced = re.sub(r"(?<!^)(?=[A-Z])", " ", raw).replace("_", " ")
    spaced = re.sub(r"\s+", " ", spaced).strip()
    return spaced or None


def normalized_variant(value: Optional[str]) -> Optional[str]:
    if value is None:
        return None
    base = normalize_text(value).replace(" ", "").replace("_", "").replace("-", "")
    return VARIANT_NORMALIZATION.get(base, base)


def serial_candidates(value: Optional[str]) -> List[str]:
    vals: List[str] = []
    if not value:
        return vals
    raw = str(value)
    parts = [raw]
    if "/" in raw:
        parts.append(raw.split("/")[0])
    for p in parts:
        norm = re.sub(r"[^0-9a-zA-Z]+", "", p).lower()
        if norm:
            vals.append(norm)
    return vals


def derive_base_id(tmpl: CardTemplate) -> Optional[int]:
    if not getattr(tmpl, "set_code", None):
        return None
    cfg = PACK_REGISTRY.get(tmpl.set_code)
    if not cfg:
        return None
    try:
        offset = int(cfg.get("template_offset") or 0)
    except Exception:
        offset = 0
    try:
        base_id = int(tmpl.template_id) - offset
        if base_id > 0:
            return base_id
    except Exception:
        return None
    return None


def load_serial_map_for_set(set_code: Optional[str]) -> Dict[int, str]:
    if not set_code:
        return {}
    cfg = PACK_REGISTRY.get(set_code)
    if not cfg:
        return {}
    csv_path = Path(cfg.get("csv_path", ""))
    if not csv_path.exists():
        return {}
    offset = int(cfg.get("template_offset") or 0)
    serial_map: Dict[int, str] = {}
    try:
        import csv as csv_module

        with open(csv_path, newline="", encoding="utf-8") as fh:
            reader = csv_module.DictReader(fh)
            for idx, row in enumerate(reader):
                serial = (
                    row.get("serial_number")
                    or row.get("card_number")
                    or row.get("cardNumber")
                    or row.get("Number")
                    or row.get("token_id")
                    or row.get("template_id")
                )
                base_id = None
                if serial:
                    try:
                        base_id = int(str(serial).split("/")[0])
                    except Exception:
                        base_id = None
                if base_id is None:
                    try:
                        base_id = int(idx + 1)
                    except Exception:
                        base_id = None
                if base_id is None:
                    continue
                tmpl_id = offset + base_id
                serial_text = str(serial) if serial else f"{base_id:03d}"
                serial_map[tmpl_id] = serial_text
    except Exception:
        return {}
    return serial_map


def collection_label(tmpl: CardTemplate) -> str:
    raw = tmpl.set_name or tmpl.set_code or ""
    return normalize_text(raw)


def primary_serial_token(tmpl: CardTemplate) -> Optional[str]:
    if getattr(tmpl, "serial_number", None):
        return str(tmpl.serial_number)
    base_id = derive_base_id(tmpl)
    if base_id:
        return str(base_id)
    return None


def cleaned_search_term(tmpl: CardTemplate) -> str:
    """
    Build structured query in the order:
    Collection / Set name -> Card serial -> Pokemon name.
    """
    collection = collection_label(tmpl)
    serial = primary_serial_token(tmpl)
    name = tmpl.card_name or ""
    if not collection or not serial or not name:
        return ""
    parts = [collection, serial, name]
    term = " ".join([p for p in parts if p]).strip()
    term = re.sub(r"[^0-9A-Za-z :'/\\-]+", " ", term)
    return re.sub(r"\s+", " ", term).strip()


def extract_market_price(card: dict, variant: Optional[str] = None) -> float:
    target_variant = normalized_variant(variant)
    prices = card.get("prices") or {}
    candidates: List[float] = []
    if isinstance(prices, dict) and target_variant:
        variants = prices.get("variants") or {}
        if isinstance(variants, dict):
            for key, var in variants.items():
                if not isinstance(var, dict):
                    continue
                key_norm = normalized_variant(key)
                if key_norm and key_norm == target_variant:
                    for price_key in ("market", "mid", "price"):
                        try:
                            val = var.get(price_key)
                            if val is not None:
                                candidates.append(float(val))
                        except Exception:
                            continue
                    conditions = var.get("conditions") if isinstance(var, dict) else {}
                    if isinstance(conditions, dict):
                        for cond in conditions.values():
                            if not isinstance(cond, dict):
                                continue
                            for price_key in ("price", "market"):
                                try:
                                    val = cond.get(price_key)
                                    if val is not None:
                                        candidates.append(float(val))
                                except Exception:
                                    continue
                    break
    if isinstance(prices, dict):
        for key in ("market", "marketPrice", "direct_low", "directLow", "mid"):
            try:
                val = prices.get(key)
                if val is not None:
                    candidates.append(float(val))
            except Exception:
                continue
        variants = prices.get("variants") or {}
        if isinstance(variants, dict):
            for var in variants.values():
                if not isinstance(var, dict):
                    continue
                for key in ("market", "mid", "price"):
                    try:
                        val = var.get(key)
                        if val is not None:
                            candidates.append(float(val))
                    except Exception:
                        continue
    return max(candidates) if candidates else 0.0


def fetch_candidates(query: str, rarity_filter: Optional[str] = None, offline_cards: Optional[List[dict]] = None) -> List[dict]:
    if offline_cards is not None:
        return offline_cards
    headers = {"Accept": "application/json"}
    if API_KEY:
        headers["Authorization"] = f"Bearer {API_KEY}"
    params = {"search": query}
    if rarity_filter:
        params["rarity"] = rarity_filter
    for attempt in range(2):
        try:
            resp = requests.get(f"{API_BASE}/cards", params=params, headers=headers, timeout=30)
            if resp.status_code in (429, 403) and attempt == 0:
                wait_for = 5.0
                print(f"[warn] rate limited term='{query}' status={resp.status_code}, sleeping {wait_for}s")
                time.sleep(wait_for)
                continue
            resp.raise_for_status()
            data = resp.json()
            break
        except Exception as exc:  # noqa: BLE001
            print(f"[error] search failed term='{query}': {exc}")
            return []
    if isinstance(data, dict):
        cards = data.get("cards") or data.get("data") or []
    else:
        cards = data
    if isinstance(cards, dict):
        cards = cards.get("cards") or cards.get("data") or []
    return cards if isinstance(cards, list) else []


def choose_best_match(tmpl: CardTemplate, cards: List[dict]) -> Tuple[Optional[dict], List[dict]]:
    if not cards:
        return None, []
    target_name = normalize_text(tmpl.card_name)
    target_set = normalize_set_name(tmpl.set_name or tmpl.set_code)
    target_rarity = normalized_rarity(tmpl.rarity)
    target_serials = serial_candidates(getattr(tmpl, "serial_number", None))
    base_id = derive_base_id(tmpl)
    if base_id:
        target_serials.append(f"{base_id:03d}")
        target_serials.append(str(base_id))
    scored: List[Tuple[int, float, dict]] = []
    for card in cards:
        name_norm = normalize_text(card.get("name"))
        set_field = card.get("setName") or card.get("set_name")
        if not set_field:
            set_obj = card.get("set")
            if isinstance(set_obj, dict):
                set_field = set_obj.get("name") or set_obj.get("code")
            else:
                set_field = set_obj
        set_norm = normalize_set_name(set_field)
        rarity_field = card.get("rarityName") or card.get("rarity")
        rarity_norm = normalized_rarity(rarity_field)
        price = extract_market_price(card)
        # Hard guard: common cards should not map to obviously expensive entries.
        if target_rarity == "common" and price and price > RARITY_CAP_COMMON:
            continue
        card_serials = serial_candidates(
            card.get("cardNumber")
            or card.get("card_number")
            or card.get("serial_number")
            or card.get("number")
            or card.get("card_number_raw")
        )
        if target_set and set_norm != target_set:
            continue
        if target_serials and card_serials and not any(s in card_serials for s in target_serials):
            # Require serial alignment when we have one to avoid name-only matches.
            continue
        score = 0
        if target_set and set_norm and set_norm == target_set:
            score += 4
        if name_norm == target_name:
            score += 2
        if target_rarity and rarity_norm == target_rarity:
            score += 4
        else:
            # Require rarity alignment; skip if it doesn't match
            continue
        if target_serials and card_serials and any(s in card_serials for s in target_serials):
            score += 6
        scored.append((score, price, card))
    if not scored:
        return None, []
    scored.sort(key=lambda item: (item[0], item[1]), reverse=True)
    top_score = scored[0][0]
    top = [item for item in scored if item[0] == top_score]
    chosen_entry = max(top, key=lambda item: item[1]) if top else scored[0]
    ambiguous = [item[2] for item in top if item[2] is not chosen_entry[2]]
    return chosen_entry[2], ambiguous


def load_offline_cards(set_code: Optional[str] = None) -> Optional[List[dict]]:
    """
    Load local PokemonPriceTracker export (ppt_mega_sets.json) to allow offline mapping.
    Optionally filters by set code/name.
    """
    fallback_path = Path(__file__).resolve().parent.parent / "price_oracle" / "ppt_mega_sets.json"
    if not fallback_path.exists():
        return None
    try:
        data = json.loads(fallback_path.read_text())
        cards = data.get("cards") if isinstance(data, dict) else data
        if isinstance(cards, dict):
            cards = cards.get("cards", [])
        if not isinstance(cards, list):
            return None
        if set_code:
            target_set = normalize_set_name(set_code)
            target_compact = target_set.replace(" ", "")
            filtered: List[dict] = []
            for c in cards:
                card_set = normalize_set_name(c.get("setName") or (c.get("set") or {}).get("name") or c.get("setId"))
                card_compact = card_set.replace(" ", "")
                if card_set == target_set or card_compact == target_compact:
                    filtered.append(c)
            cards = filtered if filtered else cards  # if no match, fall back to full list
        return cards
    except Exception:
        return None


def main():
    parser = argparse.ArgumentParser(description="Map CardTemplate rows to tcgPlayerId using PokemonPriceTracker search.")
    parser.add_argument("--force", action="store_true", help="Re-run mapping even if tcgplayer_id is already set.")
    parser.add_argument("--limit", type=int, default=0, help="Stop after mapping this many templates (0 = all).")
    parser.add_argument("--sleep", type=float, default=1.25, help="Seconds to sleep between API calls for rate limiting.")
    parser.add_argument("--set-code", type=str, default=None, help="Limit mapping to a specific set_code (e.g., meg_web or phantasmal_flames).")
    parser.add_argument("--offline", action="store_true", help="Use local ppt_mega_sets.json instead of live API.")
    args = parser.parse_args()

    if not API_KEY:
        print("[warn] No API key configured; request may be rate limited or rejected.")

    # Ensure tables (including CardPriceMapping) exist before we open a session.
    init_db()

    mapped = 0
    skipped = 0
    ambiguous_log: Dict[int, List[str]] = {}
    offline_cards = load_offline_cards(args.set_code) if args.offline else None
    if args.offline and offline_cards is None:
        print("[error] offline mode requested but ppt_mega_sets.json not found or unreadable")
        return

    with Session(engine) as session:
        existing_ids = {
            (row.tcgplayer_id, row.template_id)
            for row in session.exec(select(CardTemplate.tcgplayer_id, CardTemplate.template_id).where(CardTemplate.tcgplayer_id.is_not(None))).all()
        }
        mapping_rows = session.exec(select(CardPriceMapping)).all()
        mappings: Dict[int, CardPriceMapping] = {m.template_id: m for m in mapping_rows}
        for m in mapping_rows:
            if getattr(m, "tcgplayer_id", None):
                existing_ids.add((m.tcgplayer_id, m.template_id))
        stmt = select(CardTemplate)
        if args.set_code:
            stmt = stmt.where(CardTemplate.set_code == args.set_code)
        templates = session.exec(stmt).all()
        serial_map = load_serial_map_for_set(args.set_code)
        if serial_map:
            adjusted = 0
            for tmpl in templates:
                expected_serial = serial_map.get(tmpl.template_id)
                if expected_serial and getattr(tmpl, "serial_number", None) != expected_serial:
                    tmpl.serial_number = expected_serial
                    session.add(tmpl)
                    adjusted += 1
            if adjusted:
                session.commit()
                print(f"[info] normalized serial_number for {adjusted} templates using CSV for set={args.set_code}")
        for tmpl in templates:
            if not tmpl.card_name or tmpl.card_name.lower().startswith("template"):
                skipped += 1
                continue
            if tmpl.tcgplayer_id and not args.force:
                skipped += 1
                continue
            term = cleaned_search_term(tmpl)
            if not term:
                print(
                    f"[skip] {tmpl.template_id} '{tmpl.card_name}' missing collection/serial for mapping (set='{tmpl.set_name or tmpl.set_code}', serial='{tmpl.serial_number}')"
                )
                skipped += 1
                continue
            rarity_filter = rarity_filter_value(tmpl.rarity)
            cards = fetch_candidates(term, rarity_filter=rarity_filter, offline_cards=offline_cards)
            chosen, ambiguous = choose_best_match(tmpl, cards)
            if not chosen:
                print(f"[miss] {tmpl.template_id} '{tmpl.card_name}' set='{tmpl.set_name or tmpl.set_code}' query='{term}'")
            else:
                tcg_id = chosen.get("tcgPlayerId") or chosen.get("tcgplayerId") or chosen.get("tcg_player_id")
                price = extract_market_price(chosen, getattr(tmpl, "variant", None))
                if not tcg_id:
                    print(f"[miss] {tmpl.template_id} '{tmpl.card_name}' found match without tcgPlayerId")
                    continue
                conflict = False
                for existing_id, existing_tid in existing_ids:
                    if str(existing_id) == str(tcg_id) and existing_tid != tmpl.template_id:
                        print(f"[skip-conflict] template={tmpl.template_id} tcgPlayerId={tcg_id} already used by template={existing_tid}")
                        conflict = True
                        break
                if conflict:
                    skipped += 1
                    continue

                tmpl.tcgplayer_id = str(tcg_id)
                rarity_norm = normalized_rarity(tmpl.rarity)
                if args.offline and rarity_norm in {"common", "uncommon"}:
                    price = 0.10
                if price and price > 0 and (getattr(tmpl, "current_price", 0) <= 0 or args.force or args.offline):
                    tmpl.current_price = float(price)
                    tmpl.current_price_updated_at = time.time()
                    tmpl.cached_price = float(price)
                    tmpl.cached_price_updated_at = tmpl.current_price_updated_at
                session.add(tmpl)
                mapping_entry = mappings.get(tmpl.template_id) or CardPriceMapping(template_id=tmpl.template_id)
                mapping_entry.tcgplayer_id = str(tcg_id)
                ppt_id = chosen.get("id") or chosen.get("_id")
                if ppt_id:
                    mapping_entry.ppt_id = str(ppt_id)
                mapping_entry.last_mapped_at = time.time()
                if not mapping_entry.last_price_fetch_at:
                    mapping_entry.last_price_fetch_at = mapping_entry.last_mapped_at
                mapping_entry.fetch_attempt_count = mapping_entry.fetch_attempt_count or 0
                session.add(mapping_entry)
                mappings[tmpl.template_id] = mapping_entry
                existing_ids.add((tmpl.tcgplayer_id, tmpl.template_id))
                session.commit()
                mapped += 1
                amb_text = f"{len(ambiguous)} other candidates" if ambiguous else "unique"
                price_text = f"${price:.2f}" if price else "no-price"
                rarity_label = chosen.get("rarityName") or chosen.get("rarity")
                serial_label = chosen.get("cardNumber") or chosen.get("number")
                print(
                    f"[mapped] template={tmpl.template_id} -> tcgPlayerId={tcg_id} rarity={rarity_label} serial={serial_label} ({amb_text}, {price_text})"
                )
                if ambiguous:
                    ambiguous_log[tmpl.template_id] = [str(a.get('tcgPlayerId') or a.get('name')) for a in ambiguous]
            time.sleep(max(0.0, args.sleep))
            if args.limit and mapped >= args.limit:
                break
    print(f"[done] mapped={mapped} skipped={skipped} ambiguous={len(ambiguous_log)}")
    if ambiguous_log:
        print("Ambiguous templates (review manually):")
        for tid, entries in ambiguous_log.items():
            print(f"  - template {tid}: {', '.join(entries)}")


if __name__ == "__main__":
    main()
