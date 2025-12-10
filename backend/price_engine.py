import os
import threading
import time
from typing import Any, Dict, Iterable, List, Optional, Type

import requests
from sqlmodel import Session, select

MIN_REQUEST_SPACING = 1.05  # ~60 requests/min cap
_ENGINE_THREAD: Optional[threading.Thread] = None


def _base_url(settings) -> str:
    return getattr(settings, "pokemon_price_tracker_base", None) or "https://www.pokemonpricetracker.com/api/v2"


def _api_key(settings) -> Optional[str]:
    return (
        getattr(settings, "pokemon_price_tracker_api_key", None)
        or getattr(settings, "pokemon_price_api_key", None)
        or os.environ.get("POKEMON_PRICE_TRACKER_API_KEY")
        or os.environ.get("POKEMON_PRICE_API_KEY")
    )


def _headers(settings) -> Dict[str, str]:
    headers = {"Accept": "application/json"}
    key = _api_key(settings)
    if key:
        headers["Authorization"] = f"Bearer {key}"
    return headers


def _normalize_text(value: Optional[str]) -> str:
    return " ".join(str(value or "").lower().replace("_", " ").split())


def _normalize_set(value: Optional[str]) -> str:
    raw = value or ""
    if ":" in raw:
        raw = raw.split(":", 1)[1]
    return _normalize_text(raw)


def _normalize_variant(value: Optional[str]) -> Optional[str]:
    if value is None:
        return None
    base = _normalize_text(value).replace(" ", "").replace("_", "").replace("-", "")
    if base in {"reverseholo", "reverseholofoil", "reverse"}:
        return "reverse_holo"
    if base in {"holo", "holofoil", "foil"}:
        return "holo"
    if base in {"normal", "nonholo", "nonholofoil", "base"}:
        return "normal"
    return base


def _extract_market_price(card: dict, variant: Optional[str] = None) -> float:
    target_variant = _normalize_variant(variant)
    prices = card.get("prices") or {}
    candidates: List[float] = []
    if isinstance(prices, dict) and target_variant:
        variants = prices.get("variants") or {}
        if isinstance(variants, dict):
            for key, var in variants.items():
                if not isinstance(var, dict):
                    continue
                key_norm = _normalize_variant(key)
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


def _throttled_get(url: str, params: Dict[str, Any], settings, logger, last_call: float) -> tuple[list, float]:
    headers = _headers(settings)
    elapsed = time.time() - last_call
    if elapsed < MIN_REQUEST_SPACING:
        time.sleep(MIN_REQUEST_SPACING - elapsed)
    try:
        resp = requests.get(url, headers=headers, params=params, timeout=20)
        resp.raise_for_status()
        data = resp.json()
    except Exception as exc:  # noqa: BLE001
        if logger:
            logger.warning("price_engine_request_failed url=%s params=%s error=%s", url, params, exc, exc_info=True)
        return [], time.time()
    cards = data
    if isinstance(data, dict):
        cards = data.get("data") or data.get("cards") or []
    if isinstance(cards, dict):
        cards = cards.get("cards") or cards.get("data") or []
    if not isinstance(cards, list):
        cards = []
    return cards, time.time()


def _record_price(
    session: Session,
    tmpl,
    price: float,
    now_ts: float,
    PriceHistory: Type,
    PriceSnapshot: Optional[Type],
) -> bool:
    if price is None or price <= 0:
        return False
    tmpl.current_price = float(price)
    tmpl.current_price_updated_at = now_ts
    tmpl.cached_price = float(price)
    tmpl.cached_price_updated_at = now_ts
    session.add(tmpl)
    session.add(PriceHistory(card_template_id=tmpl.template_id, price=float(price), collected_at=now_ts))
    if PriceSnapshot:
        session.add(
            PriceSnapshot(
                template_id=tmpl.template_id,
                source="pokemonpricetracker_v2",
                currency="USD",
                market_price=float(price),
                direct_low=float(price),
                mid_price=float(price),
                low_price=float(price),
                high_price=float(price),
                raw_market_price=float(price),
                raw_near_mint_price=float(price),
                psa8_price=0.0,
                psa9_price=0.0,
                psa10_price=0.0,
                last_updated=now_ts,
                is_stale=False,
                fetch_attempt_count=0,
                collected_at=now_ts,
            )
        )
    return True


def refresh_prices_once(
    engine,
    settings,
    logger,
    CardTemplate: Type,
    PriceHistory: Type,
    PriceSnapshot: Optional[Type] = None,
) -> dict:
    """
    Fetch latest prices using stored tcgplayer_id and write CardTemplate + PriceHistory rows.
    """
    base_url = _base_url(settings)
    if not base_url:
        return {"updated": 0, "missing": 0, "skipped": 0}
    updated = 0
    missing = 0
    skipped = 0
    now_ts = time.time()
    with Session(engine) as session:
        templates = session.exec(select(CardTemplate).where(CardTemplate.tcgplayer_id.is_not(None))).all()
        # Try bulk by set to reduce request volume (best effort).
        grouped: Dict[str, List[Any]] = {}
        for tmpl in templates:
            set_key = _normalize_set(getattr(tmpl, "set_name", None) or getattr(tmpl, "set_code", None))
            if set_key:
                grouped.setdefault(set_key, []).append(tmpl)
        last_call = 0.0
        processed: set[int] = set()
        for set_key, tmpls in grouped.items():
            if len(tmpls) < 3:
                continue
            cards, last_call = _throttled_get(f"{base_url}/cards", {"search": set_key}, settings, logger, last_call)
            idx: Dict[str, dict] = {}
            for card in cards:
                tcg_id = card.get("tcgPlayerId") or card.get("tcgplayerId") or card.get("tcg_player_id")
                if tcg_id is not None:
                    idx[str(tcg_id)] = card
            if not idx:
                continue
            for tmpl in tmpls:
                card = idx.get(str(tmpl.tcgplayer_id))
                if not card:
                    continue
                price = _extract_market_price(card, getattr(tmpl, "variant", None))
                if _record_price(session, tmpl, price, now_ts, PriceHistory, PriceSnapshot):
                    updated += 1
                else:
                    skipped += 1
                processed.add(tmpl.template_id)
        # Per-card fallback with rate limiting.
        for tmpl in templates:
            if tmpl.template_id in processed:
                continue
            tcg_id = str(tmpl.tcgplayer_id)
            params = {"tcgPlayerId": tcg_id}
            cards, last_call = _throttled_get(f"{base_url}/cards", params, settings, logger, last_call)
            card = None
            for cand in cards:
                cand_id = cand.get("tcgPlayerId") or cand.get("tcgplayerId") or cand.get("tcg_player_id")
                if cand_id is not None and str(cand_id) == tcg_id:
                    card = cand
                    break
            if not card and cards:
                card = cards[0]
            if not card:
                missing += 1
                continue
            price = _extract_market_price(card, getattr(tmpl, "variant", None))
            if _record_price(session, tmpl, price, now_ts, PriceHistory, PriceSnapshot):
                updated += 1
            else:
                skipped += 1
        session.commit()
    if logger:
        logger.info("price_engine_tick complete updated=%s skipped=%s missing=%s", updated, skipped, missing)
    return {"updated": updated, "missing": missing, "skipped": skipped}


def start_price_engine(
    engine,
    settings,
    logger,
    CardTemplate: Type,
    PriceHistory: Type,
    PriceSnapshot: Optional[Type] = None,
):
    global _ENGINE_THREAD
    if _ENGINE_THREAD is not None:
        return
    if not getattr(settings, "price_fetch_enabled", True):
        if logger:
            logger.info("price_engine_disabled_via_config")
        return
    interval_minutes = max(5, int(getattr(settings, "price_fetch_interval_minutes", 15) or 15))
    interval_seconds = interval_minutes * 60

    def _loop():
        while True:
            try:
                refresh_prices_once(engine, settings, logger, CardTemplate, PriceHistory, PriceSnapshot)
            except Exception as exc:  # noqa: BLE001
                if logger:
                    logger.warning("price_engine_tick_failed error=%s", exc, exc_info=True)
            time.sleep(interval_seconds)

    _ENGINE_THREAD = threading.Thread(target=_loop, daemon=True)
    _ENGINE_THREAD.start()
