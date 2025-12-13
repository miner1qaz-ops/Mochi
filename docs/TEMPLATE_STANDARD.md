# TEMPLATE_STANDARD (Mainnet Card Identity)

This document is Mochi’s **single source of truth** for **card template identity** on mainnet.

Goal: “never wrong template / never wrong price / never placeholder in packs”.

Hard constraints:
- No secrets/API keys in docs or code.
- BCP 47 language tags only (RFC 5646), e.g. `en`, `en-SG`, `ja-JP`.
- Identity must be enforceable by ingestion validation (not human memory).

---

## 0) Definitions

- **Template**: the canonical identity row for a specific printed card + finish/printing. (Not an individual NFT.)
- **Finish**: non-holo vs holo vs reverse-holo vs special foils; always identity-bearing.
- **Printing flags**: edition/printing modifiers (promo, shadowless, stamped, etc); identity-bearing.
- **Oracle mapping**: link from a template to an external provider’s stable card identifier(s).

---

## 1) Canonical Template Identity (“natural key”)

### 1.1 Canonical key format (required)

```text
TEMPLATE_KEY = "{lang}:{set_code}:{collector_number}:{name_norm}:{rarity_norm}:{finish}:{printing_flags}"
```

Rules:
- All components are **required** and must be non-empty.
- `:` is reserved as the separator; components must not contain `:`.
- `lang` in the key is the lowercased BCP 47 tag (BCP 47 is case-insensitive). Store the original as `language_tag` (e.g. `ja-JP`), but key uses `ja-jp`.

### 1.2 Required fields (ingestion must provide or deterministically derive)

Ingestion MUST fail if any is missing:
- `language_tag` (BCP 47)
- `set_code` (canonical and stable; see §2)
- `set_name` (display; validated against set registry)
- `collector_number` (printed card number; see §1.4)
- `rarity_norm` (canonical enum; see §1.6)
- `finish` (canonical enum; see §1.7)
- `name_printed` (UTF-8, as printed)
- `name_norm` (key-safe ASCII normalization; see §1.5)
- `printing_flags` (use `-` if none; see §1.8)

Mainnet rule:
> A template is not mintable/pack-eligible unless it has all required identity fields.

### 1.3 Placeholders are forbidden (mainnet)

“Template 200”, “Rare A/B”, “TBD”, etc are not valid templates.

If a row cannot satisfy the required identity fields, ingestion must **reject** it instead of creating a placeholder.

---

## 1.4 Collector number normalization

Store:
- `collector_number` (as printed; UTF-8 allowed)
- `collector_number_norm` (ASCII normalization used for comparisons/search; recommended)

Normalization rules for `collector_number_norm`:
- Trim whitespace; lowercase.
- Keep `a-z`, `0-9`, `/`, and `-`. Remove spaces and other punctuation.
- For numeric `XXX/YYY` forms, pad both sides to 3 digits when <1000:
  - `70/94` → `070/094`
  - `1/102` → `001/102`
- For promo-like identifiers (e.g. `SM123`, `SVP-001`), lowercase and remove spaces:
  - `SVP-001` → `svp-001`
  - `SM123` → `sm123`
- Reject unknown placeholders (`?`, empty, `tbd`, etc).

---

## 1.5 Name normalization (`name_norm`)

Store:
- `name_printed`: printed name (UTF-8; JP and future languages allowed)
- `name_norm`: deterministic, key-safe ASCII

`name_norm` rules:
1) Unicode normalize `name_printed` with NFKC.
2) Lowercase.
3) Replace:
   - `♀` → `-f`
   - `♂` → `-m`
4) Remove apostrophes and punctuation except internal hyphens.
5) Replace any remaining non-alphanumeric run with a single `-`.
6) Trim leading/trailing `-`.

Non-Latin names:
- Do not require human romanization.
- If the slug would be empty, use: `u-` + base32(normalized UTF-8 bytes, lowercase, no padding).

---

## 1.6 Rarity normalization (`rarity_norm`)

`rarity_norm` is required and must never be `unknown`.

Canonical enum (extend only with a migration plan):
- `energy`
- `common`
- `uncommon`
- `rare`
- `double_rare`
- `ultra_rare`
- `illustration_rare`
- `special_illustration_rare`
- `hyper_rare`

Guidance:
- Vintage “Rare Holo” vs “Rare” is modeled as `rarity_norm=rare` + `finish=holo|non_holo`.

---

## 1.7 Finish / variant (`finish`)

Finish is required and identity-bearing.

Canonical enum (extend only with a migration plan):
- `non_holo`
- `holo`
- `reverse_holo`
- `cosmos_holo`
- `cracked_ice_holo`
- `galaxy_holo`
- `rainbow_holo`
- `etched_holo`

Rules:
- If two physical printings can have different market prices, they must be **different templates** (different `finish` and/or `printing_flags`).
- Missing finish is a hard reject. If a set is known to be single-finish, ingestion must still explicitly set `finish=non_holo` (or the correct value) rather than leaving it blank.

---

## 1.8 Printing / edition flags (`printing_flags`)

`printing_flags` is a sorted `+`-joined set of tokens, or `-` if none.

Allowed tokens (initial set):
- `promo`
- `1st_edition`
- `shadowless`
- `unlimited`
- `reprint`
- `stamped`
- `staff`
- `prerelease`

Examples:
- `-`
- `promo`
- `promo+stamped`
- `shadowless`

---

## Derived artifacts (templates → assets)
- Given `(set_code, template_id)`, the canonical image URL is `https://getmochi.fun/img/{set_code_or_slug}/{template_id}.jpg`.
- Given `(set_code, template_id)`, the canonical metadata URL is `https://getmochi.fun/nft/metadata/{set_code_or_slug}/{template_id}.json`.
- Resolver order, fallbacks, and hosting details live in `docs/ASSET_IMAGE_PIPELINE.md`.

## 1.9 Examples (required edge cases)

Same name across two sets:
```text
en:ptcg-en-base1:004/102:charizard:rare:holo:-
en:ptcg-en-base2:004/130:charizard:rare:holo:-
```

Same collector number + rarity, different finish:
```text
en:mochi-en-me02:001/094:oddish:common:non_holo:-
en:mochi-en-me02:001/094:oddish:common:reverse_holo:-
```

Japanese vs English (no cross-language fallback):
```text
en:ptcg-en-base1:025/102:pikachu:common:non_holo:-
ja-jp:ptcg-ja-base1:025/102:u-<base32>:common:non_holo:-
```

Shadowless vs unlimited:
```text
en:ptcg-en-base1:004/102:charizard:rare:holo:shadowless
en:ptcg-en-base1:004/102:charizard:rare:holo:unlimited
```

---

## 2) Set / Product Naming Standard (pack identity)

### 2.1 `set_code` (canonical, stable, unique)

`set_code` must be unique across all time and all languages. It must never be re-used for a different card list.

Recommended convention:
- Official sets: `ptcg-<lang>-<official_set_code>`
  - examples: `ptcg-en-base1`, `ptcg-ja-sv4a`
- Mochi custom sets: `mochi-<lang>-<internal_set_code>`
  - examples: `mochi-en-me01`, `mochi-en-me02`

### 2.2 `set_name` (display)

`set_name` is display-only and may change, but ingestion must validate that it matches the set registry entry for the `set_code`.

### 2.3 `product_sku` (pack SKU in UI + minting)

Pack selection must be deterministic:
```text
product_sku (pack_type) -> set registry entry -> eligible templates
```

Guidance:
- Do not allow a pack to point at “mixed” sets implicitly.
- If an English product combines multiple Japanese sets, the English product still gets its own `set_code`.

---

## 3) Variant modeling rules (when a variant is a separate template)

A finish/printing variation is a separate template when:
- it has a distinct market price in at least one major marketplace, or
- it is tracked as a separate variant by the oracle provider, or
- it materially affects rarity/collectability (stamped, 1st edition, shadowless, etc).

CSV ingestion must map source columns (e.g. `holo_type`) into `finish` and must never leave finish blank.

---

## 4) Oracle mapping strategy (multi-source ready)

### 4.1 Mapping record (per template_key)

Store a mapping keyed by `template_key`:
- `template_key`
- `oracle_provider` (`pokemonpricetracker`, future providers later)
- `oracle_card_id` (stable provider ID; for PPT this is typically `tcgPlayerId`)
- `oracle_set_id` (provider setId when applicable)
- `mapping_confidence` + `last_mapped_at`
- optional: `last_verified_at`

### 4.2 Hard mapping rules (do not relax)

Oracle mapping must require exact match on:
- set identity (provider setId / strict set filter)
- collector number
- rarity
- finish

Name is a cross-check, not the primary key.

### 4.3 Japanese policy (no EN fallback)

If a JP template has no oracle coverage:
- mark it explicitly as `no-oracle`
- price must be explicit (manual per-card/per-rarity) or remain unpriced and excluded from any “priced value” UI

Hard rule:
> JP templates must never silently use EN prices.

---

## 5) Mainnet ingestion requirements (CSV → templates)

### 5.1 Required CSV columns (minimum)

Every row must include:
- `language_tag`
- `set_code`
- `set_name`
- `collector_number`
- `name_printed`
- `rarity` (or `rarity_norm`)
- `finish`
- `printing_flags` (empty allowed; normalize to `-`)

Optional but recommended:
- `oracle_provider`, `oracle_set_id`, `oracle_card_id` (when known)
- `release_date`

### 5.2 Validation checklist (must be enforced)

Ingestion must:
1) Validate BCP 47 `language_tag`.
2) Validate `set_code` exists in the set registry and matches `set_name` + language.
3) Normalize `collector_number` → `collector_number_norm` (reject invalid).
4) Normalize `name_printed` → `name_norm` (must be non-empty).
5) Normalize `rarity` → `rarity_norm` (reject unknown).
6) Validate `finish` is in the enum.
7) Canonicalize `printing_flags` to sorted `+` form (or `-`).
8) Generate `template_key`.
9) Enforce uniqueness (`UNIQUE(template_key)`).
10) Emit a diff report (new vs existing templates). Identity fields must never drift post-mint.

### 5.3 `template_id` strategy (surrogate key)

`template_id` is a surrogate (UI/DB). Canonical identity is `template_key`.

Options:
- **Option A (recommended): deterministic hash of `template_key`**
  - Derive a positive integer ≤ `2^53-1` (JS-safe) from SHA-256 (e.g., first 52 bits).
  - On collision: fail ingestion and require explicit resolution.
- **Option B: per-set offsets**
  - Allocate numeric ranges per set and enforce `UNIQUE(template_key)`.
  - Higher operational risk across languages/markets.

Recommendation:
> Use Option A for mainnet to prevent cross-set/cross-language collisions.

---

## 6) Prevent placeholders in packs (hard guardrails)

Guardrails must exist in two layers:

1) Ingestion-time:
   - placeholders never created (validation fails)

2) Pack selection-time:
   - exclude any template missing required identity fields (at minimum: set_code + collector_number + rarity + finish + language_tag)
   - exclude `rarity_norm=unknown`
   - exclude missing `template_key`

Even if bad rows exist, packs must never select them.

---

## 7) How to add a new set (EN/JP)

1) Add set registry entry (`set_code`, `set_name`, `language_tag`, `release_date`, optional oracle hints).
2) Produce a CSV meeting §5.1.
3) Run ingestion in “validate + diff” mode (no writes) and review diff.
4) Ingest (write) and verify `UNIQUE(template_key)`.
5) Map oracle IDs only with strict match (§4.2).
6) Enable scheduler only after coverage is verified.

---

## 8) Pre-mainnet checklist (template identity)

Before enabling minting for a set:
- 0 templates missing any required field (§1.2)
- 0 templates with `rarity_norm=unknown`
- 0 templates missing `finish`
- 0 templates missing collector number normalization
- oracle mappings verified for set+collector+rarity+finish
