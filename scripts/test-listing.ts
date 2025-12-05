/**
 * Quick harness to POST a marketplace listing payload to the local API.
 * Usage:
 *   API_BASE=http://127.0.0.1:3000/api \
 *   WALLET=<seller> CORE_ASSET=<core asset pubkey> PRICE_LAMPORTS=1000000000 \
 *   npx ts-node -P tsconfig.scripts.json scripts/test-listing.ts
 *
 * Or provide args: node scripts/test-listing.ts <wallet> <core_asset> <price_lamports> [currency_mint]
 */

type ListingPayload = {
  wallet: string;
  core_asset: string;
  price_lamports: number;
  currency_mint?: string;
};

const API_BASE = process.env.API_BASE || 'http://127.0.0.1:3000/api';
const [walletArg, assetArg, priceArg, currencyMintArg] = process.argv.slice(2);

const wallet = walletArg || process.env.WALLET;
const coreAsset = assetArg || process.env.CORE_ASSET;
const priceLamports = priceArg || process.env.PRICE_LAMPORTS;
const currencyMint = currencyMintArg || process.env.CURRENCY_MINT;

if (!wallet || !coreAsset || !priceLamports) {
  console.error('Usage: WALLET=<pubkey> CORE_ASSET=<core asset> PRICE_LAMPORTS=<int> [CURRENCY_MINT=<mint>] node scripts/test-listing.ts');
  process.exit(1);
}

async function main() {
  const payload: ListingPayload = {
    wallet,
    core_asset: coreAsset,
    price_lamports: Number(priceLamports),
    currency_mint: currencyMint || undefined,
  };

  const res = await fetch(`${API_BASE}/marketplace/list/build`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });

  const text = await res.text();
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    json = text;
  }

  if (!res.ok) {
    console.error(`Request failed [${res.status}]:`, json);
    process.exit(1);
  }

  console.log('Success:', json);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
