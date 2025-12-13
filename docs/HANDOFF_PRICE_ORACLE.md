# HANDOFF_PRICE_ORACLE (Temporary)

Temporary status + findings for the Mochi price oracle bootstrap work (pre–mainnet template standard).

Archive after mainnet cutover once `docs/TEMPLATE_STANDARD.md` + `../PRICE_ORACLE_RUNBOOK.md` are fully adopted.

For the canonical runbook (commands, do/don’t, credit model details), read `../PRICE_ORACLE_RUNBOOK.md`.

---

## Canonical entrypoints (what to run)

**1) Safe probe (1 request, prints credit headers)**
- File: `backend/scripts/debug_price_api.py`
- Command (from repo root): `POKEMON_PRICE_TRACKER_API_KEY=... backend/.venv/bin/python backend/scripts/debug_price_api.py pikachu`

**2) Bootstrap missing prices (slow, budgeted, fuses)**
- File: `backend/tasks/bootstrap_prices.py`
- Command (from repo root):
  - `set -a; source backend/.env; set +a`
  - `POKEMON_PRICE_TRACKER_API_KEY=... PRICE_BOOTSTRAP_BUDGET=200 backend/.venv/bin/python -m backend.tasks.bootstrap_prices`
- Behavior:
  - Targets only templates that have **no** `PriceSnapshot` and `current_price==0` and `cached_price==0`.
  - Low tiers are static (no PPT calls): Energy `$0.05`, Common `$0.05`, Uncommon `$0.07`.
  - Rare+ templates are mapped (search) then priced (by `tcgPlayerId`).
  - Fuses: abort after >5× `429`, abort immediately on any `403`.
  - PSA/eBay fields are **off by default**; opt-in via `PPT_INCLUDE_EBAY=true`.

**3) Maintenance scheduler (runs on backend startup, rare+ only)**
- File: `backend/smart_price_scheduler.py` (started from `backend/main.py` on startup)
- Gate: `PRICE_FETCH_ENABLED=true` (in `backend/.env`)
- Behavior:
  - Fetches **rare+ only**; never hits PPT for low tiers.
  - Optional PSA/eBay via `PPT_INCLUDE_EBAY=true` (default off).

---

## PPT credit rules (layman summary)

PPT charges **credits per card returned**, not per HTTP request.

From `Pokemon_price_tracker_doc.json` (`GET /cards`):

`cards_returned × (1 + includeHistory + includeEbay)`

Practical implications:
- Broad search queries can return up to ~50 cards → ~50 credits in one call.
- `includeHistory=true` adds +1 credit per returned card.
- `includeEbay=true` adds +1 credit per returned card (includes PSA/eBay fields).
- Responses may include: `X-API-Calls-Consumed`, `X-API-Calls-Breakdown`, `X-RateLimit-Remaining`.

---

## Live packs/sets (current devnet state)

From `PACK_REGISTRY` (`backend/main.py`):
- `meg_web` → “Mega Evolution” (template_offset `0`)
- `phantasmal_flames` → “Phantasmal Flames” (template_offset `2000`)

PPT set hints used by the bootstrap mapper:
- `ME01: Mega Evolution` (setId `68cc2d9c7d3e6e7d391a6716`)
- `ME02: Phantasmal Flames` (setId `690368ee113266e35b29f628`)

---

## Variant handling status (holo / reverse / normal)

Current:
- `CardTemplate.variant` exists in DB (`backend/main.py`) and is used by price extraction to select from PPT’s `prices.variants`.
- `scripts/mint_core_from_csv.py` populates `CardTemplate.variant` from CSV `holo_type` when present (Phantasmal Flames has `Holo`/`Reverse Holo`/`Non-Holo`).

Risk:
- If `variant`/finish is missing or inconsistent, pricing becomes ambiguous. The canonical flow must not “pick the highest” variant; treat the template as not oracle-safe until finish is defined (see `docs/TEMPLATE_STANDARD.md` and `../PRICE_ORACLE_RUNBOOK.md`).

---

## Placeholder template findings (current unpriced list)

These template IDs remain unpriced and appear to be placeholders (no serial; not map-safe):
- Mega Evolution unknowns: `200–213` (rarity `unknown`, no serial)
- `1002` “Rare B”
- `3001` “UltraRare A”
- `6001` “MegaHyperRare A”

Recommendation:
- Treat these as placeholders (do not map/price).
- For mainnet: do not create placeholders at all (`docs/TEMPLATE_STANDARD.md`).

---

## Remaining mainnet template identity decisions (exact list)

Before mainnet, we still need to standardize:
1) Canonical unique key fields (now defined in `docs/TEMPLATE_STANDARD.md`).
2) Finish normalization and CSV → DB mapping.
3) Rarity normalization taxonomy.
4) Template ID scheme (hash of `template_key` vs offsets).
5) Collector number canonical format rules.
6) Set identity source of truth (internal `set_code` vs provider setId).
7) Language support policy (JP must never fall back to EN).
8) Low-tier policy confirmation (static forever vs eventual oracle mapping).
9) Placeholder policy (mainnet: forbidden; enforce via ingestion + pack selection guardrails).

