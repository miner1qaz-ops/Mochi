"""
Price scheduler that respects PokemonPriceTracker limits while prioritizing fresh oracle data.

- Runs a capped cycle every 4 hours (6/day) under 60 req/min and <20k req/day.
- Prioritizes unmapped/no-price cards, then stale (>4h) cards with rare+ first.
- Only fetches rare+ templates; low tiers are static and must not hit PPT.
- Optional PSA/eBay fields can be enabled via env (see `PRICE_ORACLE_RUNBOOK.md`).
"""

import os
import threading
import time
from datetime import datetime, timezone
from typing import Dict, List, Optional, Type, Tuple

import requests
from sqlmodel import Session, select, func

MIN_DELAY_SECONDS = 1.2  # guard against >60 req/min
MAX_CALLS_PER_MINUTE = 50
CYCLE_SECONDS = 4 * 3600
CYCLE_REQUEST_BUDGET = 3200
STALE_AFTER_SECONDS = 4 * 3600
_SCHEDULER_THREAD: Optional[threading.Thread] = None


def _include_ebay_enabled() -> bool:
    flag = str(os.environ.get("PPT_INCLUDE_EBAY", "") or "").strip().lower()
    return flag in {"1", "true", "yes", "y"}


def _api_key(settings) -> Optional[str]:
    return (
        getattr(settings, "pokemon_price_tracker_api_key", None)
        or getattr(settings, "pokemon_price_api_key", None)
        or os.environ.get("POKEMON_PRICE_TRACKER_API_KEY")
        or os.environ.get("POKEMON_PRICE_API_KEY")
    )


def _base_url(settings) -> str:
    return getattr(settings, "pokemon_price_tracker_base", None) or "https://www.pokemonpricetracker.com/api/v2"


def _headers(settings) -> Dict[str, str]:
    headers = {"Accept": "application/json"}
    key = _api_key(settings)
    if key:
        headers["Authorization"] = f"Bearer {key}"
    return headers


def _normalize_text(value: Optional[str]) -> str:
    return " ".join(str(value or "").lower().replace("_", " ").split())


def _normalized_rarity(value: Optional[str]) -> str:
    return _normalize_text(value).replace(" ", "").replace("_", "").replace("-", "")


def _is_rare_plus(value: Optional[str]) -> bool:
    norm = _normalized_rarity(value)
    return norm not in {"common", "uncommon", "energy", ""}


def _normalize_variant(value: Optional[str]) -> Optional[str]:
    if value is None:
        return None
    base = str(value or "").lower().replace(" ", "").replace("_", "").replace("-", "")
    if base in {"reverseholo", "reverseholofoil", "reverse"}:
        return "reverse_holo"
    if base in {"holo", "holofoil", "foil"}:
        return "holo"
    if base in {"normal", "nonholo", "nonholofoil", "base"}:
        return "normal"
    return base


def _parse_timestamp(value: Optional[str]) -> Optional[float]:
    if not value:
        return None
    try:
        sanitized = str(value).replace("Z", "+00:00")
        return datetime.fromisoformat(sanitized).astimezone(timezone.utc).timestamp()
    except Exception:
        return None


def _extract_price(card: dict, variant: Optional[str] = None) -> float:
    target_variant = _normalize_variant(variant)
    prices = card.get("prices") or {}
    if not isinstance(prices, dict):
        return 0.0

    def _first_positive(candidates: List[Optional[float]]) -> Optional[float]:
        for cand in candidates:
            try:
                if cand is not None and float(cand) > 0:
                    return float(cand)
            except Exception:
                continue
        return None

    def _extract_from_variant_entry(entry: dict) -> float:
        # Prefer market-like fields; do not "max across variants" (variant ambiguity is unsafe).
        preferred = _first_positive([entry.get("market"), entry.get("mid"), entry.get("price")])
        if preferred is not None:
            return preferred
        conds = entry.get("conditions")
        if isinstance(conds, dict):
            for cond in conds.values():
                if not isinstance(cond, dict):
                    continue
                preferred = _first_positive([cond.get("market"), cond.get("price")])
                if preferred is not None:
                    return preferred
        return 0.0

    variants = prices.get("variants") or {}
    if target_variant:
        if isinstance(variants, dict):
            for key, var in variants.items():
                if _normalize_variant(key) == target_variant and isinstance(var, dict):
                    return _extract_from_variant_entry(var)
        # If a finish was requested but isn't present, do not guess.
        return 0.0

    # No variant requested: prefer top-level prices (if present).
    preferred = _first_positive(
        [
            prices.get("market"),
            prices.get("marketPrice"),
            prices.get("direct_low"),
            prices.get("directLow"),
            prices.get("mid"),
            prices.get("price"),
        ]
    )
    if preferred is not None:
        return preferred

    # If no top-level price exists, use an unambiguous variant only.
    if isinstance(variants, dict) and variants:
        normal_entry = None
        for key, var in variants.items():
            if _normalize_variant(key) == "normal" and isinstance(var, dict):
                normal_entry = var
                break
        if normal_entry is not None:
            return _extract_from_variant_entry(normal_entry)
        if len(variants) == 1:
            only = next(iter(variants.values()))
            if isinstance(only, dict):
                return _extract_from_variant_entry(only)
    return 0.0


def _extract_near_mint(prices: dict) -> float:
    conds = prices.get("conditions") if isinstance(prices, dict) else {}
    if not isinstance(conds, dict):
        return 0.0
    near_mint = conds.get("Near Mint") or conds.get("NearMint") or conds.get("near_mint")
    if isinstance(near_mint, dict):
        for key in ("price", "market"):
            try:
                val = near_mint.get(key)
                if val is not None:
                    return float(val)
            except Exception:
                continue
    return 0.0


def _extract_grade_price(card: dict, grade_key: str) -> float:
    ebay = card.get("ebay") or {}
    grade_entry = None
    if isinstance(ebay, dict):
        sales = ebay.get("salesByGrade") or {}
        if isinstance(sales, dict):
            grade_entry = sales.get(grade_key)
        grade_entry = grade_entry or ebay.get(grade_key)
    if not isinstance(grade_entry, dict):
        return 0.0
    smart = grade_entry.get("smartMarketPrice") if isinstance(grade_entry.get("smartMarketPrice"), dict) else None
    if smart and smart.get("price") is not None:
        try:
            return float(smart.get("price"))
        except Exception:
            pass
    for key in ("marketPrice7Day", "marketPrice", "averagePrice", "medianPrice"):
        try:
            val = grade_entry.get(key)
            if val is not None:
                return float(val)
        except Exception:
            continue
    return 0.0


def _extract_prices(card: dict, rarity: Optional[str], variant: Optional[str] = None) -> dict:
    raw_market = _extract_price(card, variant)
    prices = card.get("prices") if isinstance(card, dict) else {}
    raw_near_mint = _extract_near_mint(prices if isinstance(prices, dict) else {})
    return {
        "raw_market_price": float(raw_market or 0),
        "raw_near_mint_price": float(raw_near_mint or 0),
        "psa8_price": _extract_grade_price(card, "psa8") if _is_rare_plus(rarity) else 0.0,
        "psa9_price": _extract_grade_price(card, "psa9") if _is_rare_plus(rarity) else 0.0,
        "psa10_price": _extract_grade_price(card, "psa10") if _is_rare_plus(rarity) else 0.0,
        "last_updated_ts": _parse_timestamp(
            (prices or {}).get("lastUpdated")
            or (prices or {}).get("lastMarketUpdate")
            or (prices or {}).get("updatedAt")
            or card.get("updatedAt")
        ),
    }


def _respect_rate_limits(last_call: float, minute_state: Dict[str, float]) -> Tuple[float, Dict[str, float]]:
    now = time.time()
    elapsed_minute = now - minute_state.get("start", now)
    if elapsed_minute >= 60:
        minute_state = {"start": now, "count": 0}
    if minute_state.get("count", 0) >= MAX_CALLS_PER_MINUTE:
        sleep_for = 60 - elapsed_minute
        if sleep_for > 0:
            time.sleep(sleep_for)
        minute_state = {"start": time.time(), "count": 0}
    elapsed_call = time.time() - last_call
    if elapsed_call < MIN_DELAY_SECONDS:
        time.sleep(MIN_DELAY_SECONDS - elapsed_call)
    return time.time(), minute_state


def _stable_tcg_id(tmpl, mapping) -> Optional[str]:
    if mapping and getattr(mapping, "tcgplayer_id", None):
        return str(mapping.tcgplayer_id)
    if getattr(tmpl, "tcgplayer_id", None):
        return str(tmpl.tcgplayer_id)
    return None


def _last_price_timestamp(tmpl, mapping, latest_snap_ts: Dict[int, float]) -> float:
    candidates: List[float] = []
    for key in ("current_price_updated_at", "cached_price_updated_at"):
        try:
            val = getattr(tmpl, key, 0) or 0
            if val:
                candidates.append(float(val))
        except Exception:
            continue
    if mapping and getattr(mapping, "last_price_fetch_at", None):
        candidates.append(float(mapping.last_price_fetch_at))
    snap_ts = latest_snap_ts.get(tmpl.template_id)
    if snap_ts:
        candidates.append(float(snap_ts))
    return max(candidates) if candidates else 0.0


def _priority_key(tmpl, mapping, latest_snap_ts: Dict[int, float]) -> tuple:
    last_ts = _last_price_timestamp(tmpl, mapping, latest_snap_ts)
    has_price = (getattr(tmpl, "current_price", 0) or getattr(tmpl, "cached_price", 0) or 0) > 0
    stale = last_ts <= 0 or (time.time() - last_ts) > STALE_AFTER_SECONDS
    rare_rank = 0 if _is_rare_plus(getattr(tmpl, "rarity", "")) else 1
    no_price_rank = 0 if not has_price else 1
    stale_rank = 0 if stale else 1
    return (no_price_rank, stale_rank, rare_rank, last_ts or 0)


def _fetch_card_by_id(tcgplayer_id: str, settings, logger, include_ebay: bool) -> Optional[dict]:
    url = f"{_base_url(settings)}/cards"
    params = {"tcgPlayerId": tcgplayer_id}
    if include_ebay:
        params["includeEbay"] = "true"
    try:
        resp = requests.get(url, params=params, headers=_headers(settings), timeout=20)
        if resp.status_code in (429, 403):
            if logger:
                logger.warning("price_scheduler_rate_limited id=%s status=%s", tcgplayer_id, resp.status_code)
            return None
        resp.raise_for_status()
        data = resp.json()
    except Exception as exc:  # noqa: BLE001
        if logger:
            logger.warning("price_scheduler_fetch_failed id=%s error=%s", tcgplayer_id, exc, exc_info=True)
        return None
    cards = data
    if isinstance(data, dict):
        cards = data.get("cards") or data.get("data") or []
    if isinstance(cards, dict):
        cards = cards.get("cards") or cards.get("data") or []
    if not isinstance(cards, list):
        cards = []
    card_obj = None
    for c in cards:
        cid = c.get("tcgPlayerId") or c.get("tcgplayerId") or c.get("tcg_player_id")
        if cid is not None and str(cid) == str(tcgplayer_id):
            card_obj = c
            break
    if not card_obj and cards:
        card_obj = cards[0]
    return card_obj


def start_smart_price_scheduler(
    engine,
    settings,
    logger,
    CardTemplate: Type,
    PriceHistory: Type,
    PriceSnapshot: Optional[Type] = None,
    CardPriceMapping: Optional[Type] = None,
):
    """Start the scheduler in a daemon thread."""
    global _SCHEDULER_THREAD
    if _SCHEDULER_THREAD is not None:
        return
    if not getattr(settings, "price_fetch_enabled", True):
        if logger:
            logger.info("smart_price_scheduler_disabled")
        return
    cycle_budget = int(os.environ.get("PRICE_SCHEDULER_BUDGET", CYCLE_REQUEST_BUDGET))

    def _loop():
        while True:
            cycle_start = time.time()
            calls_made = 0
            minute_state = {"start": time.time(), "count": 0}
            last_call = 0.0
            include_ebay = _include_ebay_enabled()
            try:
                with Session(engine) as session:
                    mapping_lookup: Dict[int, object] = {}
                    if CardPriceMapping:
                        mappings = session.exec(select(CardPriceMapping)).all()
                        mapping_lookup = {m.template_id: m for m in mappings}
                    latest_snap_ts: Dict[int, float] = {}
                    if PriceSnapshot:
                        snap_rows = session.exec(
                            select(PriceSnapshot.template_id, func.max(PriceSnapshot.collected_at)).group_by(PriceSnapshot.template_id)
                        ).all()
                        latest_snap_ts = {tid: ts for tid, ts in snap_rows if tid is not None}
                    now = time.time()
                    templates = session.exec(select(CardTemplate)).all()
                    candidates = []
                    for t in templates:
                        mapping = mapping_lookup.get(t.template_id)
                        if not _is_rare_plus(getattr(t, "rarity", "")):
                            continue
                        if not _stable_tcg_id(t, mapping):
                            continue
                        last_ts = _last_price_timestamp(t, mapping, latest_snap_ts)
                        has_price = (getattr(t, "current_price", 0) or getattr(t, "cached_price", 0) or 0) > 0
                        stale = last_ts <= 0 or (now - last_ts) > STALE_AFTER_SECONDS
                        if not has_price or stale:
                            candidates.append(t)
                    candidates.sort(key=lambda t: _priority_key(t, mapping_lookup.get(t.template_id), latest_snap_ts))
                    if not candidates:
                        time.sleep(CYCLE_SECONDS)
                        continue
                    for tmpl in candidates:
                        if calls_made >= cycle_budget:
                            break
                        mapping = mapping_lookup.get(tmpl.template_id)
                        if mapping is None and CardPriceMapping:
                            mapping = CardPriceMapping(template_id=tmpl.template_id, tcgplayer_id=getattr(tmpl, "tcgplayer_id", None))
                            mapping_lookup[tmpl.template_id] = mapping
                        tcg_id = _stable_tcg_id(tmpl, mapping)
                        if not tcg_id:
                            continue
                        last_call, minute_state = _respect_rate_limits(last_call, minute_state)
                        card_obj = _fetch_card_by_id(tcg_id, settings, logger, include_ebay)
                        now_ts = time.time()
                        calls_made += 1
                        minute_state["count"] = minute_state.get("count", 0) + 1
                        if mapping:
                            mapping.fetch_attempt_count = int(getattr(mapping, "fetch_attempt_count", 0) or 0) + 1
                            mapping.last_price_fetch_at = now_ts
                            mapping.last_status = "ok" if card_obj else "miss"
                            if not getattr(mapping, "tcgplayer_id", None) and getattr(tmpl, "tcgplayer_id", None):
                                mapping.tcgplayer_id = tmpl.tcgplayer_id
                            if card_obj and not getattr(mapping, "ppt_id", None):
                                mapping.ppt_id = card_obj.get("id") or getattr(mapping, "ppt_id", None)
                            session.add(mapping)
                        if not card_obj:
                            session.commit()
                            continue
                        price_fields = _extract_prices(card_obj, getattr(tmpl, "rarity", ""), getattr(tmpl, "variant", None))
                        raw_market = price_fields["raw_market_price"]
                        raw_near_mint = price_fields["raw_near_mint_price"]
                        psa8 = price_fields["psa8_price"]
                        psa9 = price_fields["psa9_price"]
                        psa10 = price_fields["psa10_price"]
                        last_updated = price_fields["last_updated_ts"] or now_ts
                        adjusted_market = raw_market
                        adjusted_near_mint = raw_near_mint
                        if adjusted_market <= 0 and adjusted_near_mint > 0:
                            adjusted_market = adjusted_near_mint
                        if adjusted_market <= 0:
                            if mapping:
                                mapping.last_status = "no-price"
                                session.add(mapping)
                                session.commit()
                            continue
                        tmpl.current_price = float(adjusted_market)
                        tmpl.current_price_updated_at = now_ts
                        tmpl.cached_price = float(adjusted_market)
                        tmpl.cached_price_updated_at = now_ts
                        session.add(tmpl)
                        session.add(PriceHistory(card_template_id=tmpl.template_id, price=float(adjusted_market), collected_at=now_ts))
                        if PriceSnapshot:
                            snapshot = PriceSnapshot(
                                template_id=tmpl.template_id,
                                source="pokemonpricetracker_scheduler",
                                currency="USD",
                                market_price=float(adjusted_market),
                                direct_low=float(adjusted_market),
                                mid_price=float(adjusted_market),
                                low_price=float(adjusted_near_mint or adjusted_market),
                                high_price=float(adjusted_market),
                                raw_market_price=float(raw_market),
                                raw_near_mint_price=float(raw_near_mint),
                                psa8_price=float(psa8 or 0),
                                psa9_price=float(psa9 or 0),
                                psa10_price=float(psa10 or 0),
                                last_updated=float(last_updated),
                                is_stale=False,
                                fetch_attempt_count=int(getattr(mapping, "fetch_attempt_count", 0)) if mapping else 0,
                                collected_at=now_ts,
                            )
                            session.add(snapshot)
                        session.commit()
                        if logger:
                            logger.info(
                                "smart_price_scheduler_update template=%s price=%.2f include_ebay=%s calls=%s/%s",
                                tmpl.template_id,
                                adjusted_market,
                                include_ebay,
                                calls_made,
                                cycle_budget,
                            )
            except Exception as exc:  # noqa: BLE001
                if logger:
                    logger.warning("smart_price_scheduler_tick_failed error=%s", exc, exc_info=True)
            sleep_time = max(0, CYCLE_SECONDS - (time.time() - cycle_start))
            time.sleep(sleep_time)

    _SCHEDULER_THREAD = threading.Thread(target=_loop, daemon=True)
    _SCHEDULER_THREAD.start()
