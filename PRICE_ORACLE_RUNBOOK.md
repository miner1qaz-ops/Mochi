# PRICE_ORACLE_RUNBOOK

Canonical, low-risk process for mapping + pricing Mochi card templates via PokemonPriceTracker (PPT).

Mainnet prerequisites:
- Template identity standard: `docs/TEMPLATE_STANDARD.md` (set/language/collector number/rarity/finish; placeholders forbidden).
- Temporary status: `docs/HANDOFF_PRICE_ORACLE.md` (archive after mainnet cutover).

---

## Credit model (what “costs credits”)

PPT credits are per **card returned**, not per HTTP request.

From `Pokemon_price_tracker_doc.json` (`GET /cards`) the credit cost is:

`cards_returned × (1 + includeHistory + includeEbay)`

Practical implications:
- Broad search queries can return up to ~50 cards → ~50 credits in one call.
- `includeEbay=true` adds +1 credit per returned card (PSA/eBay fields).

---

## Canonical entrypoints (only approved ways to hit PPT)

1) **Safe probe (limit=1)**
- File: `backend/scripts/debug_price_api.py`
- Goal: validate auth + credit headers without burning budget.

2) **Bootstrap (slow + budgeted + fuses)**
- File: `backend/tasks/bootstrap_prices.py`
- Goal: map + price only templates missing prices.
- Gate budgets with `PRICE_BOOTSTRAP_BUDGET`.

3) **Maintenance scheduler (rare+ only)**
- File: `backend/smart_price_scheduler.py`
- Runs on backend startup only when `PRICE_FETCH_ENABLED=true`.

Everything else that can map/fetch prices is deprecated and must be deleted, archived, or gated behind explicit env flags default false.

---

## Template identity prerequisites (do not skip)

Oracle mapping must never be “name-only”.

Before any mapping/pricing run:
- Templates must have canonical identity fields per `docs/TEMPLATE_STANDARD.md`.
- Mapping must require:
  - set identity (provider setId / strict set filter)
  - collector number
  - rarity
  - finish (non-holo vs holo vs reverse vs special foils)
- JP (and other languages) must never fall back to EN pricing.

---

## Canonical selection logic (what gets fetched)

### Low tiers are static (no PPT calls)

We do not hit PPT for low tiers. Prices are set deterministically:
- Energy: `$0.05`
- Common: `$0.05`
- Uncommon: `$0.07`

### Rare+ only for PPT

Rare+ templates are the only ones eligible for PPT calls (bootstrap and scheduler).

---

## Mapping rules (merged from PRICE_MAPPING_GUIDE.md)

Use these keys in this exact order when identifying a card against PPT:

1) Set identity (setId / strict set filter; never name-only)
2) Collector number
3) Printed name (cross-check only)
4) Rarity (normalized)
5) Finish / variant

Rules:
- Build search strings as `"${collector_number} ${name}"` (keep them tight).
- Pass a strict set filter (`setId` preferred) plus a rarity filter.
- Never map by name alone; if set/collector/finish is missing, fix template data first instead of guessing.
- After mapping, reuse stable IDs (`tcgPlayerId` / provider IDs) for refresh instead of repeating searches.

Pitfalls:
- Serial format drift (`70/94` vs `070/094`) — normalize collector numbers.
- Finish drift (Reverse Holo vs Holo) — treat as different templates; do not “pick the highest”.
- Language drift — JP never uses EN prices.

---

## Variant handling (finish/foil selection)

Variant selection is driven by finish (`CardTemplate.variant` today; mainnet will store `finish` explicitly).

Hard rule:
- If finish is missing or not present in the oracle payload, do not guess. Treat the template as not oracle-safe.

---

## Do / Don’t

Do:
- Keep searches strict: set + collector number + name + rarity + finish.
- Prefer setId filters to avoid returning many candidates (credit spikes).
- Keep bootstrap budgets small and delays high when quota is tight.
- Stop immediately on repeated `429` or any `403`.

Don’t:
- Don’t use legacy bulk refresh paths (`/pricing/fetch`, bulk `/api/prices`, or legacy scripts) unless explicitly re-enabled for emergencies.
- Don’t accept name-only matches.

