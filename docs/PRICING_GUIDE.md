# Pricing & Mapping Guide

This document describes how we map Mochi card templates to external PokemonPriceTracker data and keep prices fresh.

## Architecture
- Source of truth: `CardTemplate` rows (name, rarity, serial_number, set_code/set_name).
- Mapper: `scripts/map_prices.py`
  - Searches PokemonPriceTracker `/api/v2/cards?search=<name>` with bearer `POKEMON_PRICE_TRACKER_API_KEY`.
  - Filters results by **rarity**, **set**, and **serial_number** to avoid mis-mapping (e.g., Common → Illustration Rare).
  - Normalizes serials from pack CSV + template offsets (index-based) and uses variant-aware prices (Holo vs Reverse) so cards that share a name across rarities/prints map correctly.
  - Rejects obvious mismatches (Common cards with market price > $10).
  - Offline mode (`--offline`) reads `price_oracle/ppt_mega_sets.json`; in offline mode Commons/Uncommons are capped to `$0.10` to avoid vintage overpricing.
  - Writes `tcgplayer_id`, `current_price`, and cached timestamps when a match is found.
  - CLI options:
    - `--set-code <meg_web|phantasmal_flames|...>` to scope the run.
    - `--force` to remap rows that already have a tcgplayer_id.
    - `--sleep` to adjust per-request delay (default 1.25s).
- Live updater: `backend/smart_price_scheduler.py` (auto-start on FastAPI startup) counts mapped cards, computes delay = `max(1.5s, 3600/total_cards)` to stay under 60 req/min, updates cards oldest-first by `tcgplayer_id`, writes `current_price`, `PriceHistory`, and optional `PriceSnapshot`, and recalculates cadence every 100 cards.
  - Tuning: override cycle/delay with env `PRICE_SCHEDULER_TARGET_SECONDS` (e.g., `7200` for 2h) and `PRICE_SCHEDULER_MIN_DELAY_SECONDS` (e.g., `1.2` to allow ~50 req/min if quota permits).
- Bulk cache refresher: `start_price_fetcher` in `backend/main.py` runs `refresh_price_cache()` every ~15 minutes to import PokemonPriceTracker bulk data or fallback `price_oracle/ppt_mega_sets.json` (values are used as-is; offline mapper clamps Commons/Uncommons to $0.10 before writing to DB) and backfill missing `tcgplayer_id`/price.
- Legacy engine: `backend/price_engine.py` retained for manual one-off throttled runs; not part of the default startup path.
- API reference: repo root `Pokemon_price_tracker_doc.json` (OpenAPI endpoints, query params, and rate limits).

## Add a New Set
1) **Place CSV**: Add the set CSV alongside existing files (e.g., `frontend/public/data/mega_evolutions.csv`). Ensure columns include name, rarity, and serial/card number if available.
2) **Import templates**: Use existing import scripts (e.g., `scripts/import_card_templates.py`) so `CardTemplate` rows contain name, rarity, serial_number, and set_code.
3) **Map tcgplayer IDs**:
   ```bash
   # activate env
   source backend/.env
   source .venv/bin/activate
   PROGRAM_ID=Gc7u33eCs81jPcfzgX4nh6xsiEtRYuZUyHKFjmf5asfx \
   SEED_SALE_PROGRAM_ID=2mt9FhkfhrkC5RL29MVPfMGVzpFR3eupGCMqKVYssiue \
   python scripts/map_prices.py --set-code <your_set_code>
   ```
4) **Verify**: Check `CardTemplate` rows have `tcgplayer_id` and `current_price` populated; confirm `PriceHistory` rows exist.

## Troubleshooting
- **Prices missing or zero**
  - Confirm `POKEMON_PRICE_TRACKER_API_KEY` is loaded.
  - Ensure rarity spelling matches API output (e.g., `DoubleRare`, `Illustration Rare` are normalized by the script).
  - Add `serial_number` for tighter matching; the mapper prefers serial+set matches over name-only.
- **Rate limited (429/403)**
  - Increase `--sleep` to 2-3s and re-run a filtered subset with `--set-code`.
  - If the API is offline, run `refresh_price_cache()` to hydrate from the local `ppt_mega_sets.json` cache (contains tcgPlayerId + prices for Mega Evolutions).
- **Ambiguous matches**
  - The script skips high-value cards for Common rarity and will refuse to map if rarity/set/serial disagree. Review logs (`[miss]` entries) and adjust template data (rarity/serial) before re-running.
