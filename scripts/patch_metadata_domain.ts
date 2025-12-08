/**
 * Patch minted metadata domains by rewriting URLs to getmochi.fun.
 *
 * Usage:
 *   RPC_URL=https://api.helius.xyz/?api-key=... TS_NODE_TRANSPILE_ONLY=1 npx ts-node -P tsconfig.scripts.json scripts/patch_metadata_domain.ts --collection <collectionPubkey> --out ./patched_metadata
 *
 * What it does:
 *   - Scans all assets in the given collection via DAS `getAssetsByGroup`.
 *   - For each asset with a json_uri/metadata_uri, fetches the metadata.
 *   - Rewrites any fields containing the legacy domain to "getmochi.fun" (image, animation_url, properties.files[].uri, and any nested strings).
 *   - Writes the patched JSON to the output directory as <asset_id>.json.
 *
 * You still need to host/upload the patched JSON and images under https://getmochi.fun/nft/...
 * (or set up redirects). This script only produces the patched metadata locally.
 */

import fs from 'fs';
import path from 'path';

type DasAsset = {
  id: string;
  content?: {
    json_uri?: string;
    metadata_uri?: string;
    uri?: string;
  };
};

const RPC_URL = process.env.RPC_URL || process.env.SOLANA_RPC || 'https://api.devnet.solana.com';
const COLLECTION = getArg('--collection');
const OUT_DIR = getArg('--out') || './patched_metadata';

if (!COLLECTION) {
  console.error('Missing --collection <pubkey>');
  process.exit(1);
}

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const assets = await fetchAssetsByCollection(COLLECTION);
  console.log(`Fetched ${assets.length} assets in collection ${COLLECTION}`);

  let patchedCount = 0;
  for (const asset of assets) {
    const uri =
      asset.content?.json_uri ||
      asset.content?.metadata_uri ||
      asset.content?.uri;
    if (!uri) continue;
    try {
      const res = await fetch(uri);
      if (!res.ok) {
        console.warn(`Skip ${asset.id}: fetch failed ${res.status}`);
        continue;
      }
      const json = await res.json();
      const fromDomain = process.env.LEGACY_DOMAIN || 'getmochi.fun';
      const patched = rewriteDomains(json, fromDomain, 'getmochi.fun');
      const outPath = path.join(OUT_DIR, `${asset.id}.json`);
      fs.writeFileSync(outPath, JSON.stringify(patched, null, 2));
      patchedCount++;
    } catch (e) {
      console.warn(`Skip ${asset.id}: ${String(e)}`);
    }
  }
  console.log(`Patched ${patchedCount} metadata files. Output: ${OUT_DIR}`);
}

function rewriteDomains(obj: any, from: string, to: string): any {
  if (obj === null || obj === undefined) return obj;
  if (typeof obj === 'string') {
    return obj.includes(from) ? obj.replaceAll(from, to) : obj;
  }
  if (Array.isArray(obj)) {
    return obj.map((v) => rewriteDomains(v, from, to));
  }
  if (typeof obj === 'object') {
    const out: Record<string, any> = {};
    for (const [k, v] of Object.entries(obj)) {
      out[k] = rewriteDomains(v, from, to);
    }
    return out;
  }
  return obj;
}

async function fetchAssetsByCollection(collection: string): Promise<DasAsset[]> {
  const pageSize = 1000;
  let page = 1;
  const all: DasAsset[] = [];
  while (true) {
    const body = {
      jsonrpc: '2.0',
      id: `mochi-patch-${page}`,
      method: 'getAssetsByGroup',
      params: {
        groupKey: 'collection',
        groupValue: collection,
        page,
        limit: pageSize,
        displayOptions: { showCollectionMetadata: true },
      },
    };
    const res = await fetch(RPC_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      throw new Error(`DAS error ${res.status}: ${await res.text()}`);
    }
    const data = await res.json();
    const items: DasAsset[] = data?.result?.items || [];
    all.push(...items);
    if (items.length < pageSize) break;
    page++;
  }
  return all;
}

function getArg(name: string): string | undefined {
  const idx = process.argv.indexOf(name);
  if (idx >= 0 && idx + 1 < process.argv.length) {
    return process.argv[idx + 1];
  }
  return undefined;
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
