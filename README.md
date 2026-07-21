# PonsShare

Launch fixed-supply tokens on **Robinhood Chain** through [pons](https://ponsfamily.com) — with optional **social fee sharing** via Privy wallets tied to X handles.

PonsShare is a non-custodial launch layer. Your wallet signs every transaction. We never custody keys or funds.

## Features

- **Launch** (`/launch`) — pons-style create form, IPFS upload, wallet connect, `launchToken()` tx
- **Explore** (`/explore`) — recent launches from pons indexer (with on-chain fallback)
- **Claim** (`/claim`) — fee recipients log in with X and view launches tied to their handle
- **Fee share** — pre-generate a Privy embedded wallet per X handle at launch time

## Stack

- Next.js 16 (App Router)
- wagmi + viem (injected wallet only)
- Privy (social login + embedded wallets)
- Robinhood Chain (chain ID `4663`)

## Network (from [docs.ponsfamily.com](https://docs.ponsfamily.com))

| | |
|---|---|
| Chain | Robinhood Chain (4663) |
| RPC | `https://rpc.mainnet.chain.robinhood.com` |
| Explorer | [robinhoodchain.blockscout.com](https://robinhoodchain.blockscout.com) |
| Pool fee | 10000 (1%) |
| Launch fee | 0.0005 ETH |
| Supply | 1,000,000,000 (fixed) |
| Active factory | `0xA5aAb3F0c6EeadF30Ef1D3Eb997108E976351feB` (block 8991118) |
| Active locker | `0x736D76699C26D0d966744cAe304C000d471f7F35` |
| WETH | `0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73` |

### Fee routing (on-chain)

At launch, set `feeWallet` in `launchToken()` metadata. After launch, the locker exposes `feeRedirects(token)` — if zero, fees go to the deployer; otherwise to the redirect address. PonsShare supports:

- **Default** — your connected wallet
- **Share fees** — social account (X/GitHub) or custom wallet address
  - Social: looks up `fee_share_wallets` by platform + handle; reuses existing wallet or creates one at launch
  - First login on `/claim` links the stored wallet to Privy so fees can be claimed

On-chain reads live in `src/lib/pons/token-state.ts` (`readTokenOnchainMetadata`, `readGraduationStatus`, `readCreatorFeeRouting`).

### Indexing

Trust-minimized: index factory `TokenLaunched` events from block **8991118**, then pool `Swap` events. Public RPC times out on wide `eth_getLogs` — backfill in bounded chunks.

## Setup

```bash
cp .env.example .env.local
npm install
npm run dev
```

Open http://localhost:3000

### Environment

See `.env.example` for Privy and Supabase keys. Token images upload through pons (`POST /api/ipfs/image`).

### Supabase

1. Create a project at [supabase.com](https://supabase.com)
2. Run `supabase/schema.sql` in **Database → SQL Editor**
3. Copy **Project URL**, **anon key**, and **service role key** into `.env.local`
4. Generate a server-only encryption key and add it to `.env.local` and Vercel:

```bash
openssl rand -base64 32
# → set as FEE_WALLET_ENCRYPTION_KEY (never commit this value)
```

5. Restart the dev server

Fee-share private keys are encrypted with **AES-256-GCM** before they are written to Supabase or local JSON. The decryption key lives only in environment variables.

Without Supabase, launches and fee-share wallets fall back to local JSON under `data/` (gitignored). Fee claim tracking requires Supabase.

## Launch flow

1. Upload token image → pons `POST /api/ipfs/image` (via `/api/pons/ipfs`) → `ipfs://…`
2. Read launch config → factory fee, max dev buy, graduation target
3. Optional fee routing on `launchToken()` metadata:
   - **Default** — creator fees (70% of trading fees) go to your connected wallet
   - **Custom wallet** — set `feeWallet` to any Robinhood Chain address
   - **Social share** — PonsShare generates a wallet and links it to X/GitHub for `/claim`
4. Sign `launchToken()` on factory `0xA5aAb3F0c6EeadF30Ef1D3Eb997108E976351feB`
5. Best-effort indexer registration via `/api/pons/verify`

## Costs

- **Launch fee**: `0.0005 ETH`
- **Optional dev buy**: dynamic cap (~0.0678 ETH today, 5% of supply)
- **Graduation**: `4.2 ETH`

## Disclaimer

Unofficial layer on pons. Not affiliated with Pons Labs. Tokens are volatile; transactions may be irreversible.
