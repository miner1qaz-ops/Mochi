"""
Quick sanity check for the PokemonPriceTracker API.

Reads POKEMON_PRICE_TRACKER_API_KEY from the environment and fetches one price.
"""
import os
import requests

API_URL = os.environ.get("POKEMON_PRICE_API") or os.environ.get("POKEMON_PRICE_ENDPOINT") or "https://www.pokemonpricetracker.com/api/prices"
API_KEY = os.environ.get("POKEMON_PRICE_TRACKER_API_KEY") or os.environ.get("POKEMON_PRICE_API_KEY")


def extract_price_value(card: dict) -> float:
    candidates = []
    prices = card.get("prices") or {}
    if isinstance(prices, dict):
        for val in prices.values():
            try:
                if isinstance(val, (int, float)):
                    candidates.append(float(val))
            except Exception:
                continue
        conds = prices.get("conditions") if isinstance(prices.get("conditions"), dict) else {}
        for cond in conds.values():
            if isinstance(cond, dict):
                for key in ("price", "market", "direct_low", "directLow"):
                    if cond.get(key) is not None:
                        try:
                            candidates.append(float(cond[key]))
                        except Exception:
                            continue
    for key in ("price", "market_price", "display_price"):
        try:
            val = card.get(key)
            if val:
                candidates.append(float(val))
        except Exception:
            continue
    for cand in candidates:
        if cand and cand > 0:
            return float(cand)
    return 0.0


def main():
    headers = {}
    if API_KEY:
        headers["Authorization"] = f"Bearer {API_KEY}"
    try:
        resp = requests.get(API_URL, params={"limit": 200}, headers=headers, timeout=20)
    except Exception as exc:  # noqa: BLE001
        print(f"API Error: {exc}")
        return
    if resp.status_code != 200:
        print(f"API Error: {resp.status_code}")
        return
    data = resp.json()
    cards = None
    if isinstance(data, dict):
        cards = data.get("cards") or data.get("data")
    elif isinstance(data, list):
        cards = data
    if not cards:
        print(f"API Alive: 200 OK but no cards in response (payload keys: {list(data.keys()) if isinstance(data, dict) else type(data)})")
        return
    card = cards[0]
    price = 0.0
    for c in cards:
        val = extract_price_value(c if isinstance(c, dict) else {})
        if val > 0:
            card = c
            price = val
            break
    if price <= 0:
        price = extract_price_value(card if isinstance(card, dict) else {})
    name = card.get("name") or "unknown"
    if price > 0:
        print(f"API Alive: {name} = ${price:.2f}")
    else:
        print(f"API Alive: {name} (no price fields returned)")


if __name__ == "__main__":
    main()
