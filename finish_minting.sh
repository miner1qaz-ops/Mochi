#!/usr/bin/env bash
set -euo pipefail

OFFSETS=(0 20 40 60 80 100 120 140 160 180 200 220 240)

for off in "${OFFSETS[@]}"; do
  echo "=== Mint batch offset=${off} limit=20 ==="
  TS_NODE_TRANSPILE_ONLY=1 \
  PACK_ID=phantasmal_flames \
  TEMPLATE_OFFSET=2000 \
  CORE_TEMPLATE_CSV=frontend/public/data/phantasmal_flames.csv \
  CORE_METADATA_BASE=https://getmochi.fun/nft/metadata/phantasmal_flames \
  CORE_TEMPLATE_LIMIT=20 \
  CORE_TEMPLATE_OFFSET=${off} \
  npx ts-node -P tsconfig.scripts.json scripts/mint_and_deposit.ts
  echo "=== Batch offset=${off} complete, sleeping... ==="
  sleep 5
done

echo "All batches attempted."
