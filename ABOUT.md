# About PonsShare

PonsShare is a **non-custodial launch layer** on top of [pons](https://ponsfamily.com) on **Robinhood Chain** (chain ID `4663`).

It lets anyone launch fixed-supply tokens through the same on-chain pons factory as the official app, while adding one thing pons does not focus on: **routing creator fees to someone else at launch time** — especially via **X (Twitter) or GitHub** accounts tied to Privy wallets.

Your wallet signs every launch and fee claim. PonsShare never holds user funds or private keys for connected wallets.

---

## What problem it solves

On pons, the person who launches a token normally receives the **creator share** of trading fees (70% on current factory launches). That works when the launcher is also the creator who should earn.

PonsShare is for cases where you want to:

- Launch a token **for** a creator, promoter, or collaborator
- Set **creator fees** to a specific wallet at launch
- Or share fees with an **X or GitHub handle** before that person has connected a wallet — they can **claim later** after logging in on `/claim`

---

## How it relates to pons

PonsShare is **not** a new protocol or factory. It is a custom frontend and backend that:

1. Uses the **active pons factory** (`0xA5aAb3F0c6EeadF30Ef1D3Eb997108E976351feB`)
2. Uploads token images to IPFS (pons API first, Pinata fallback when pons is unreachable)
3. Builds and submits the same **`launchToken()`** transaction your wallet would sign on ponsfamily.com
4. Reads token state **directly from chain** (metadata, pool price, graduation, creator fee routing)

Launched tokens trade in the same WETH pools on Robinhood Chain as any other pons launch. Graduation, pool fees, and launch protection follow pons rules.

---

## Main features

| Page | Purpose |
|---|---|
| **/** | Landing — what PonsShare is and how fee sharing works |
| **/launch** | Create a token — form, image upload, optional fee share, wallet launch |
| **/explore** | Tokens launched **through PonsShare only** (not the full pons feed) |
| **/launchpad/[token]** | Token details — price, market cap, graduation, chart, creator fees, on-chain facts |
| **/claim** | Fee recipients log in with X/GitHub (Privy) and see launches linked to them |

### Fee sharing modes at launch

- **Default** — creator fees go to your connected wallet
- **Wallet** — set `feeWallet` to any address
- **Social** — PonsShare creates or reuses a platform wallet for an X/GitHub handle; on first `/claim` login, Privy links that wallet to the social account

### Creator fees on token details

The token page reads accrued creator fees from pons’ market API and shows balances similar to pons’ creator fee UI. Eligible wallets can **claim fees** on-chain via the pons locker’s `collectFees(token)` function.

---

## Tech stack

- **Next.js 16** (App Router)
- **wagmi + viem** — wallet connect and on-chain reads/writes
- **Privy** — X/GitHub login and embedded wallets for `/claim`
- **Supabase** — launch registry, fee-share wallets, claim tracking (optional; local JSON fallback when not configured)
- **Robinhood Chain RPC** — primary source of truth for pricing and graduation

---

## What gets stored where

| Data | Where |
|---|---|
| Launches created via PonsShare | Supabase `ponsshare_launches` or `data/ponsshare-launches.json` |
| Social fee-share wallets | Supabase `fee_share_wallets` or local registry |
| Token metadata, pool, fees | On-chain (token + factory + locker contracts) |
| Images | IPFS (`ipfs://…` URI on token `logo()`) |

---

## Costs (pons protocol)

- **Launch fee:** `0.0005 ETH`
- **Optional dev buy:** capped (~5% of supply)
- **Graduation threshold:** `4.2 ETH` paired in the locked WETH pool
- **Pool trading fee:** 1% (10000 fee tier)

---

## What PonsShare is not

- Not affiliated with Pons Labs or an official pons product
- Not a custodial launchpad — no depositing ETH or tokens into PonsShare
- Not a full pons explorer — `/explore` only lists PonsShare launches
- Not financial advice — tokens are user-created and can be volatile or illiquid

---

## Repository

- **GitHub:** [PonsShare/PonsShare](https://github.com/PonsShare/PonsShare)
- **Setup:** see [README.md](./README.md)
- **Database schema:** [supabase/schema.sql](./supabase/schema.sql)

---

## Disclaimer

PonsShare is provided as-is. Review token addresses, liquidity, and transaction previews before signing. Transactions on Robinhood Chain may be irreversible.
