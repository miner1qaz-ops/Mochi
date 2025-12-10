# Price Mapping Guide

Use all four keys in this exact order when identifying a card against the Pokemon Price Tracker API:

1. Collection / Set name (e.g., `Mega Evolution`, `Phantasmal Flames`)
2. Card serial number (e.g., `4/102`, `223/198`)
3. Pokemon name (e.g., `Charizard`, `Gardevoir ex`)
4. Rarity (e.g., `Rare`, `Ultra Rare`, `Special Illustration Rare`)

Mapping rules:
- Build search strings as `"${collection} ${serial} ${name}"` and pass `rarity` as a query filter.
- Never map by name alone; if the set or serial is missing, fix the data first instead of guessing.
- Reuse stable identifiers (tcgplayer_id/PPT card id) for later price refreshes rather than repeating fuzzy searches.

Examples:
- Mega Evolution — `4/102 Charizard` (Holo Rare): search string `Mega Evolution 4/102 Charizard`, rarity filter `Holo Rare`.
- Phantasmal Flames — `223/198 Gardevoir ex` (Special Illustration Rare): search string `Phantasmal Flames 223/198 Gardevoir ex`, rarity filter `Special Illustration Rare`.

Common pitfalls to avoid:
- Name-only matches (many Charizards/Pikachus share names across sets and rarities).
- Ignoring serial formats (`4` vs `4/102`) or set codes (Base Set Charizard vs Anniversary reprints).
- Cross-rarity variants (e.g., Reverse Holo vs Holo) — ensure variant/rarity align before accepting a match.
- Missing collection or serial data in `CardTemplate` — populate those fields before running the mapper.
