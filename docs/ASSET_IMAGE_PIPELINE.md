# ASSET_IMAGE_PIPELINE

Mainnet-safe image pipeline for Mochi cards. Use this to keep pack opens, hero tiles, marketplace, and profiles from breaking when third-party metadata hosts are down or unparseable.

Related:
- Template identity: `docs/TEMPLATE_STANDARD.md`
- Canonical resolver implementation: `frontend/lib/resolveCardArt.ts`

---

## Reality check (why this exists)
- Core NFTs on-chain store a URI that points to off-chain JSON; the image itself is not on-chain.
- Indexers (Helius/DAS) sometimes return `content.image`/`files` as `null` when the referenced JSON host is offline or malformed.
- Therefore the UI **must not depend on “Helius parsed image fields”** as the only art source. Always derive art deterministically from template identity.

---

## Canonical URL standard (no card names in filenames)
- Images:   `https://getmochi.fun/img/{set_slug_or_set_code}/{template_id}.jpg`
- Metadata: `https://getmochi.fun/nft/metadata/{set_slug_or_set_code}/{template_id}.json`
- Inputs come from template identity (pack slots / DB). Do **not** introduce name-based filenames (e.g. no `pikachu.jpg`).

---

## Resolver order (use everywhere: hero, gacha, profile, market)
1) **Backend-provided `image_url`** in the payload (fastest; zero extra calls).
2) **Local static / CSV-derived art** (frontend deterministic paths for the set).
3) **Canonical metadata fetch** from `getmochi.fun` to read `image` if art is still missing.
4) **Placeholder** `/card_back.png` as the final fallback.

Follow this order in all views so broken/offline metadata hosts never surface as missing art on mainnet.
