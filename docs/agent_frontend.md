# Frontend – Next.js App Router
Path: `frontend/`

## Stack
- Next.js 14 (App Router, TypeScript)
- TailwindCSS + custom palette (ink/sakura/aurora/coin)
- Framer Motion for reveals/tilt
- Solana wallet adapter (Phantom, Solflare, Backpack)

## Env
- `NEXT_PUBLIC_SOLANA_RPC`
- `NEXT_PUBLIC_BACKEND_URL`
- `NEXT_PUBLIC_ADMIN_ADDRESS`
- `NEXT_PUBLIC_USDC_MINT` (devnet default: `GWRsfsckjMn2vRZjUf3756AdZiNJULG6E6oTvbK6SvRu`)

## Routes
- `/` – Hero, RWA diagram, live feed mock.
- `/gacha` – Client seed input, preview RNG (calls `/program/open/preview`), build pack, 11-card reveal UI, claim/sellback buttons, 1h countdown. The page now auto-resumes any pending session by calling `GET /program/session/pending` when a wallet connects (so refreshes show the same lineup/countdown), and it disables buy/claim/sell buttons with explicit loading states while wallet prompts or RPC calls are in flight to prevent spam clicks. A dedicated “Resume pending pack” button under the buy controls lets ops manually rehydrate the session if needed. When the timer hits zero the UI surfaces an `Expire session` button that calls `/program/expire/build`, prompting the user to sign the cleanup transaction so the old pack can be cleared without admin help.
  - Front-end now surfaces backend error strings (e.g., “Active pack session already exists”) beside the Buy Pack controls, shows explicit “Awaiting wallet signature → Submitting transaction” states so Phantom prompts are expected, and displays the active session id/countdown whenever a pack is pending.
- `/marketplace` – Grid of listings from backend with hover animation; buy/cancel buttons (placeholder actions).
  - Buy/cancel wired to backend builders and wallet signing; list form available (asset + price lamports).
- `/profile` – Redirects to connected wallet; `/profile/[address]` fetches holdings via backend profile endpoint.
- `/admin` – Devnet-friendly dashboard (wallet gate temporarily disabled) showing inventory counts, searchable asset list, session mirrors, buttons that call `/admin/inventory/refresh` / `/admin/inventory/assets` to sync with Helius, plus a “Force expire all” control that hits `/admin/sessions/force_expire`. A new wallet input + “Force close session” button calls `/admin/sessions/force_close` (uses the on-chain `admin_force_close_session` to free stuck PDAs). Diagnostics blocks pull `/admin/sessions/diagnostic` and `/admin/inventory/reserved` so you can see which cards/sessions are stuck before clearing them. Session mirrors list now paginates (Prev/Next) using the backend’s `page`/`page_size` params so the UI stays responsive even with large histories.
- Provably-fair panel on `/gacha` displays `server_seed_hash`, `server_nonce`, `entropy_proof` from backend responses.
- Provably-fair dashboard cards show server_seed_hash, server_nonce, client_seed, entropy_proof, and verification steps (hash/nnonce/entropy reproduction).
- Transaction helper: `lib/tx.ts` decodes instruction metadata and builds v0 transactions from backend responses (uses returned `recent_blockhash`); gacha page wires claim/sellback buttons to `signTransaction` + `connection.sendTransaction`.
  - Pack purchase now also signs/sends using the same helper and blockhash.
  - Marketplace buy/cancel/list actions use the same helper + blockhash for signing.
- Gacha and marketplace offer USDC toggles that auto-derive user/vault ATAs using `NEXT_PUBLIC_USDC_MINT` (manual ATA derivation helper).
- Backend also returns `tx_v0_b64` (unsigned v0 tx) if you prefer to deserialize directly instead of rebuilding from instruction metadata.

## Components
- `WalletProvider` – wraps Connection/Wallet providers; autoConnect.
- `Header` – navigation + WalletMultiButton.

## Styling
- globals: gradient background, glass cards via `card-blur` class.
- Fonts: Space Grotesk (non-default stack).

## TODOs
- Pipe built tx_b64 into wallet for signing.
- Consume backend instruction metadata (v0 message + keys) to build full transactions client-side.
- Add filters/search for marketplace and templates metadata rendering (images, rarities).
- Add responsive animations for card reveals (swipe/drag gestures).
- Add redemption flow UI.
