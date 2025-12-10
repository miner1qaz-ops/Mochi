"""
One-time bootstrap to map and price every active CardTemplate.

Behavior:
- Ensures schema is initialized.
- Maps templates missing tcgplayer_id using structured search ("set serial name" + rarity filter).
- Writes/updates CardPriceMapping rows.
- Creates an initial PriceSnapshot for templates without one (rare+ include PSA/eBay).
- Respects 55 req/min and a per-run request budget (default 18,000; cap at 20,000/day).
- Idempotent: will skip already-mapped templates and templates with existing snapshots.

Run:
  python -m backend.tasks.bootstrap_prices
"""

import os
import re
import sys
import time
from pathlib import Path
from typing import Dict, List, Optional, Tuple

import requests
from sqlmodel import Session, select

ROOT = Path(__file__).resolve().parents[2]
if str(ROOT) not in sys.path:
    sys.path.append(str(ROOT))
BACKEND_ROOT = Path(__file__).resolve().parents[1]
if str(BACKEND_ROOT) not in sys.path:
    sys.path.append(str(BACKEND_ROOT))

from backend.main import (
    PACK_REGISTRY,
    RARE_PLUS,
    SELLBACK_RATE,
    CardPriceMapping,
    CardTemplate,
    PriceHistory,
    PriceSnapshot,
    auth_settings,
    engine,
    init_db,
    is_price_stale,
    pricing_pack_prices,
    PackPriceRequest,
)
from backend.smart_price_scheduler import (  # type: ignore
    CYCLE_REQUEST_BUDGET,
    MAX_CALLS_PER_MINUTE,
    MIN_DELAY_SECONDS,
    _extract_prices,
    _fetch_card_by_id,
    _is_rare_plus,
    _respect_rate_limits,
)

# Budget guard: stop before hitting the daily 20k cap. Allow override via env.
BOOTSTRAP_REQUEST_BUDGET = int(os.environ.get("PRICE_BOOTSTRAP_BUDGET", "18000"))
BOOTSTRAP_REQUEST_BUDGET = min(BOOTSTRAP_REQUEST_BUDGET, 20000)
# Local cap for per-minute calls to stay below PPT's published 60/min (target <=50).
BOOTSTRAP_MAX_CALLS_PER_MINUTE = 50
# Extra per-call delay to keep bootstrap very slow (~10 req/min max).
BOOTSTRAP_MIN_DELAY_SECONDS = 6.0

# Map normalization helpers (aligned with scripts/map_prices.py)
RARITY_NORMALIZATION = {
    "double rare": "doublerare",
    "double_rare": "doublerare",
    "double-rare": "doublerare",
    "illustration rare": "illustrationrare",
    "special illustration rare": "specialillustrationrare",
    "mega hyper rare": "megahyperrare",
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


def primary_serial_token(tmpl: CardTemplate) -> Optional[str]:
    if getattr(tmpl, "serial_number", None):
        return str(tmpl.serial_number)
    base_id = derive_base_id(tmpl)
    if base_id:
        return str(base_id)
    return None


def build_search_term(tmpl: CardTemplate) -> str:
    collection = normalize_text(tmpl.set_name or tmpl.set_code)
    serial = primary_serial_token(tmpl)
    name = tmpl.card_name or ""
    if not collection or not serial or not name:
        return ""
    term = " ".join([collection, serial, name]).strip()
    term = re.sub(r"[^0-9A-Za-z :'/\\-]+", " ", term)
    return re.sub(r"\s+", " ", term).strip()


def fetch_candidates(
    query: str,
    rarity_filter: Optional[str],
    last_call: float,
    minute_state: Dict[str, float],
    counters: Dict[str, int],
) -> Tuple[List[dict], float, Dict[str, float], bool]:
    params = {"search": query}
    if rarity_filter:
        params["rarity"] = rarity_filter
    last_call, minute_state = _respect_rate_limits(last_call, minute_state)
    time.sleep(BOOTSTRAP_MIN_DELAY_SECONDS)
    headers = {"Accept": "application/json"}
    if auth_settings.pokemon_price_tracker_api_key:
        headers["Authorization"] = f"Bearer {auth_settings.pokemon_price_tracker_api_key}"
    resp = requests.get(f"{auth_settings.pokemon_price_tracker_base}/cards", params=params, headers=headers, timeout=20)
    status = resp.status_code
    if status == 429:
        counters["rate_limit_hits_429"] = counters.get("rate_limit_hits_429", 0) + 1
        if counters["rate_limit_hits_429"] > 5:
            print("bootstrap aborted: too many 429s (probable rate limit / credits exhausted)")
            return [], last_call, minute_state, True
    if status == 403:
        counters["blocked_hits_403"] = counters.get("blocked_hits_403", 0) + 1
        print("bootstrap aborted: API key blocked (403 from PPT) – do not keep hitting; fix key or wait before re-running.")
        return [], last_call, minute_state, True
    resp.raise_for_status()
    data = resp.json()
    cards = data
    if isinstance(data, dict):
        cards = data.get("cards") or data.get("data") or []
    if isinstance(cards, dict):
        cards = cards.get("cards") or cards.get("data") or []
    if not isinstance(cards, list):
        cards = []
    minute_state["count"] = minute_state.get("count", 0) + 1
    return cards, time.time(), minute_state, False


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


def choose_best_match(tmpl: CardTemplate, cards: List[dict]) -> Optional[dict]:
    if not cards:
        return None
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
        card_serials = serial_candidates(
            card.get("cardNumber")
            or card.get("card_number")
            or card.get("serial_number")
            or card.get("number")
            or card.get("card_number_raw")
        )
        if target_set and set_norm and target_set != set_norm:
            continue
        if target_rarity != rarity_norm:
            continue
        if target_serials and card_serials and not any(s in card_serials for s in target_serials):
            continue
        score = 0
        if target_set and set_norm and target_set == set_norm:
            score += 4
        if name_norm == target_name:
            score += 2
        if target_serials and card_serials and any(s in card_serials for s in target_serials):
            score += 6
        scored.append((score, float(card.get("prices", {}).get("market") or 0), card))
    if not scored:
        return None
    scored.sort(key=lambda item: (item[0], item[1]), reverse=True)
    return scored[0][2]


def latest_snapshot_exists(session: Session, template_id: int) -> bool:
    snap = session.exec(
        select(PriceSnapshot.template_id).where(PriceSnapshot.template_id == template_id).limit(1)
    ).first()
    return snap is not None


def process_template(
    session: Session,
    tmpl: CardTemplate,
    mapping: Optional[CardPriceMapping],
    last_call: float,
    minute_state: Dict[str, float],
    request_counter: Dict[str, int],
    counters: Dict[str, int],
    consecutive_failures: Dict[str, int],
) -> Tuple[bool, bool, float, Dict[str, float], Optional[str], bool]:
    """
    Returns (mapped, priced, last_call, minute_state, failure_reason, abort_flag)
    """
    mapped = False
    priced = False
    failure_reason: Optional[str] = None
    abort_flag = False
    tcg_id = mapping.tcgplayer_id if mapping and mapping.tcgplayer_id else tmpl.tcgplayer_id
    # Map if missing.
    if not tcg_id:
        term = build_search_term(tmpl)
        if not term:
            return mapped, priced, last_call, minute_state, "missing-set-or-serial", abort_flag
        if request_counter["count"] + 1 > BOOTSTRAP_REQUEST_BUDGET:
            return mapped, priced, last_call, minute_state, "budget-exceeded", abort_flag
        rarity_filter = rarity_filter_value(tmpl.rarity)
        try:
            cards, last_call, minute_state, abort_flag = fetch_candidates(term, rarity_filter, last_call, minute_state, counters)
            if abort_flag:
                return mapped, priced, last_call, minute_state, "aborted", True
        except Exception as exc:  # noqa: BLE001
            return mapped, priced, last_call, minute_state, f"search-failed:{exc}", abort_flag
        request_counter["count"] += 1
        best = choose_best_match(tmpl, cards)
        if not best:
            return mapped, priced, last_call, minute_state, "no-match", abort_flag
        tcg_id = best.get("tcgPlayerId") or best.get("tcgplayerId") or best.get("tcg_player_id")
        if not tcg_id:
            return mapped, priced, last_call, minute_state, "no-tcg-id", abort_flag
        if mapping is None:
            mapping = CardPriceMapping(template_id=tmpl.template_id)
        mapping.tcgplayer_id = str(tcg_id)
        ppt_id = best.get("id") or best.get("_id")
        if ppt_id:
            mapping.ppt_id = str(ppt_id)
        mapping.last_mapped_at = time.time()
        session.add(mapping)
        tmpl.tcgplayer_id = str(tcg_id)
        session.add(tmpl)
        session.commit()
        mapped = True
    # Price if missing snapshot.
    if latest_snapshot_exists(session, tmpl.template_id):
        return mapped, priced, last_call, minute_state, failure_reason, abort_flag
    if request_counter["count"] + 1 > BOOTSTRAP_REQUEST_BUDGET:
        return mapped, priced, last_call, minute_state, "budget-exceeded", abort_flag
    include_ebay = _is_rare_plus(getattr(tmpl, "rarity", ""))
    last_call, minute_state = _respect_rate_limits(last_call, minute_state)
    time.sleep(BOOTSTRAP_MIN_DELAY_SECONDS)
    card_obj = _fetch_card_by_id(tcg_id, auth_settings, None, include_ebay)
    minute_state["count"] = minute_state.get("count", 0) + 1
    request_counter["count"] += 1
    if card_obj is None:
        consecutive_failures["count"] = consecutive_failures.get("count", 0) + 1
        if consecutive_failures["count"] > 5:
            print("bootstrap aborted: too many consecutive card fetch failures (possible 429/403).")
            return mapped, priced, last_call, minute_state, "aborted", True
    else:
        consecutive_failures["count"] = 0
    now_ts = time.time()
    if mapping:
        mapping.fetch_attempt_count = int(getattr(mapping, "fetch_attempt_count", 0) or 0) + 1
        mapping.last_price_fetch_at = now_ts
        mapping.last_status = "ok" if card_obj else "miss"
        session.add(mapping)
    if not card_obj:
        session.commit()
        return mapped, priced, last_call, minute_state, "price-miss", abort_flag
    price_fields = _extract_prices(card_obj, getattr(tmpl, "rarity", ""), getattr(tmpl, "variant", None))
    raw_market = price_fields["raw_market_price"]
    raw_near_mint = price_fields["raw_near_mint_price"]
    adjusted_market = raw_market
    if not include_ebay and adjusted_market and adjusted_market < 0.10:
        adjusted_market = 0.10
    if adjusted_market <= 0 and raw_near_mint > 0:
        adjusted_market = raw_near_mint
    if adjusted_market <= 0:
        session.commit()
        return mapped, priced, last_call, minute_state, "zero-price", abort_flag
    tmpl.current_price = float(adjusted_market)
    tmpl.current_price_updated_at = now_ts
    tmpl.cached_price = float(adjusted_market)
    tmpl.cached_price_updated_at = now_ts
    session.add(tmpl)
    session.add(PriceHistory(card_template_id=tmpl.template_id, price=float(adjusted_market), collected_at=now_ts))
    snap = PriceSnapshot(
        template_id=tmpl.template_id,
        source="bootstrap",
        currency="USD",
        market_price=float(adjusted_market),
        direct_low=float(adjusted_market),
        mid_price=float(adjusted_market),
        low_price=float(raw_near_mint or adjusted_market),
        high_price=float(adjusted_market),
        raw_market_price=float(raw_market or adjusted_market),
        raw_near_mint_price=float(raw_near_mint or adjusted_market),
        psa8_price=float(price_fields["psa8_price"] or 0),
        psa9_price=float(price_fields["psa9_price"] or 0),
        psa10_price=float(price_fields["psa10_price"] or 0),
        last_updated=float(price_fields["last_updated_ts"] or now_ts),
        is_stale=False,
        fetch_attempt_count=int(getattr(mapping, "fetch_attempt_count", 0)) if mapping else 0,
        collected_at=now_ts,
    )
    session.add(snap)
    session.commit()
    priced = True
    return mapped, priced, last_call, minute_state, failure_reason, abort_flag


def sample_pack_prices(session: Session) -> None:
    rarities = ["Common", "Uncommon", "Rare", "DoubleRare", "UltraRare", "IllustrationRare", "SpecialIllustrationRare", "MegaHyperRare"]
    sample_ids: List[int] = []
    for rarity in rarities:
        stmt = (
            select(CardTemplate.template_id)
            .join(PriceSnapshot, PriceSnapshot.template_id == CardTemplate.template_id)
            .where(CardTemplate.rarity == rarity)
            .order_by(PriceSnapshot.collected_at.desc())
            .limit(1)
        )
        tid = session.exec(stmt).first()
        if tid:
            sample_ids.append(tid)
    if not sample_ids:
        print("[sanity] no priced templates to sample")
        return
    resp = pricing_pack_prices(PackPriceRequest(template_ids=sample_ids), db=session)
    print("[sanity] pack_prices samples:")
    for item in resp:
        psa_present = any([item.psa8_price, item.psa9_price, item.psa10_price])
        price_val = item.market_price or item.raw_market_price or 0
        sell_val = item.sellback_value or 0
        print(
            f"  template={item.template_id} rarity={item.rarity} price={price_val:.2f} "
            f"sellback={sell_val:.2f} stale={item.is_stale} psa={psa_present}"
        )


def main():
    init_db()
    active_sets = {cfg.get("set_code") for cfg in PACK_REGISTRY.values() if cfg.get("set_code")}
    # Allow legacy meg_web templates with null set_code.
    include_null = True
    with Session(engine) as session:
        stmt = select(CardTemplate)
        if active_sets:
            if include_null:
                stmt = stmt.where(
                    (CardTemplate.set_code.in_(active_sets)) | (CardTemplate.set_code.is_(None))
                )
            else:
                stmt = stmt.where(CardTemplate.set_code.in_(active_sets))
        templates_all = session.exec(stmt).all()
        # Skip templates that already have price data.
        priced_ids = set(session.exec(select(PriceSnapshot.template_id).group_by(PriceSnapshot.template_id)).all())
        nonzero_price_ids = set(
            session.exec(
                select(CardTemplate.template_id).where(
                    (CardTemplate.current_price > 0) | (CardTemplate.cached_price > 0)
                )
            ).all()
        )
        skip_ids = priced_ids | nonzero_price_ids
        templates = [t for t in templates_all if t.template_id not in skip_ids]
        total = len(templates_all)
        already_priced_skipped = len([t for t in templates_all if t.template_id in skip_ids])
        mapped = 0
        priced = 0
        failures: Dict[str, List[int]] = {}
        request_counter = {"count": 0}
        last_call = 0.0
        minute_state = {"start": time.time(), "count": 0, "max_per_minute": BOOTSTRAP_MAX_CALLS_PER_MINUTE}
        counters = {"rate_limit_hits_429": 0, "blocked_hits_403": 0}
        consecutive_failures = {"count": 0, "max": 0}
        print(
            f"[bootstrap] processing={len(templates)} total={total} skipped_already_priced={already_priced_skipped} sets={active_sets} budget={BOOTSTRAP_REQUEST_BUDGET} max_per_minute={BOOTSTRAP_MAX_CALLS_PER_MINUTE}"
        )
        aborted = False
        for tmpl in templates:
            mapping = session.get(CardPriceMapping, tmpl.template_id)
            did_map, did_price, last_call, minute_state, failure, abort_flag = process_template(
                session, tmpl, mapping, last_call, minute_state, request_counter, counters, consecutive_failures
            )
            mapped += 1 if did_map else 0
            priced += 1 if did_price else 0
            consecutive_failures["max"] = max(consecutive_failures.get("max", 0), consecutive_failures.get("count", 0))
            if abort_flag:
                aborted = True
                break
            if failure:
                failures.setdefault(failure, []).append(tmpl.template_id)
        print(
            f"[summary] total_templates_seen={total} already_priced_skipped={already_priced_skipped} processed_templates={len(templates)} mapped={mapped} priced={priced} requests={request_counter['count']} failures={sum(len(v) for v in failures.values())}"
        )
        for reason, tids in failures.items():
            preview = ", ".join(str(t) for t in tids[:5])
            more = "" if len(tids) <= 5 else f" (+{len(tids)-5} more)"
            print(f"  - {reason}: {preview}{more}")
        print(
            f"[limits] rate_limit_hits_429={counters.get('rate_limit_hits_429',0)} blocked_hits_403={counters.get('blocked_hits_403',0)} consecutive_fetch_failures_max={consecutive_failures.get('max',0)}"
        )
        if aborted:
            print("[status] bootstrap aborted early due to rate-limit/blocked fuse.")
        try:
            sample_pack_prices(session)
        except Exception as exc:  # noqa: BLE001
            print(f"[sanity] pack price sampling failed: {exc}")


if __name__ == "__main__":
    main()
