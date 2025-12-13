"""
Quick sanity check for the PokemonPriceTracker (PPT) v2 API.

Reads `POKEMON_PRICE_TRACKER_API_KEY` from the environment and performs a safe probe:
- `GET /api/v2/cards?limit=1&search=...`
- prints HTTP status + credit/ratelimit headers when present
"""
import os
import sys
import requests

API_BASE = os.environ.get("POKEMON_PRICE_TRACKER_BASE_URL", "https://www.pokemonpricetracker.com/api/v2")
API_KEY = os.environ.get("POKEMON_PRICE_TRACKER_API_KEY") or os.environ.get("POKEMON_PRICE_API_KEY")


def main():
    headers = {}
    if API_KEY:
        headers["Authorization"] = f"Bearer {API_KEY}"
    query = "pikachu"
    if len(sys.argv) > 1 and sys.argv[1].strip():
        query = sys.argv[1].strip()
    try:
        resp = requests.get(f"{API_BASE}/cards", params={"limit": 1, "search": query}, headers=headers, timeout=20)
    except Exception as exc:  # noqa: BLE001
        print(f"API Error: {exc}")
        return
    print(f"status={resp.status_code}")
    for key in ("X-API-Calls-Consumed", "X-API-Calls-Breakdown", "X-RateLimit-Remaining"):
        if key in resp.headers:
            print(f"{key}={resp.headers.get(key)}")
    try:
        data = resp.json()
    except Exception as exc:  # noqa: BLE001
        print(f"json_error={exc}")
        return
    cards = []
    meta = None
    if isinstance(data, dict):
        cards = data.get("data") or data.get("cards") or []
        meta = data.get("metadata")
    elif isinstance(data, list):
        cards = data
    if isinstance(cards, dict):
        cards = [cards]
    if not isinstance(cards, list):
        cards = []
    print(f"cards_returned={len(cards)}")
    if cards and isinstance(cards[0], dict):
        print(f"sample_name={cards[0].get('name')} tcgPlayerId={cards[0].get('tcgPlayerId')}")
    if isinstance(meta, dict) and isinstance(meta.get("apiCallsConsumed"), dict):
        print(f"metadata.apiCallsConsumed={meta.get('apiCallsConsumed')}")


if __name__ == "__main__":
    main()
