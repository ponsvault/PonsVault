# PonsVault

Launch fixed-supply tokens on **Robinhood Chain** through [pons](https://ponsfamily.com), with a **vault** attached that turns the token's creator fees into an automatic, public rule.

PonsVault is a non-custodial launch layer. Your wallet signs every transaction. We never custody keys or funds.

## What a vault is

Every pons token earns creator fees from trading. Normally those fees accrue to the creator's wallet. A vault is a contract that receives them instead and spends them according to a rule fixed at launch:

- **Buyback & Burn** — fees buy the token off the market and burn it (available today)
- **Staking** — holders stake the token and earn the fees in WETH, pro rata (available today)
- **Lottery** — fees fund a prize pool paid to a holder each round (planned)

Vault parameters are set once, at launch. None of them has a setter, so nobody can change them afterwards — not the creator, and not us. Triggering a vault is permissionless: anyone can call `run()`, and the vault pays for itself out of the fees it collects.

## Features

- **Launch** (`/launch`) — create form, IPFS upload, wallet connect, vault template picker
- **Explore** (`/explore`) — recent launches with market data
- **Token page** (`/launchpad/[token]`) — trade, plus vault config, lifetime burn/harvest stats and a public Run button
- **Docs** (`/docs`) — how vaults earn, the parameters, and the security model

## Stack

- Next.js 16 (App Router)
- wagmi + viem (injected wallet only)
- Foundry (`contracts/`) for the vault, factory and launcher
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

At launch, `feeWallet` in the `launchToken()` metadata decides where creator fees go. After launch, the locker exposes `feeRedirects(token)` — if zero, fees go to the deployer; otherwise to the redirect address.

Launching **with** a vault goes through `PonsVaultLauncher`, which becomes the token's on-chain deployer. That is what makes fee collection permissionless: the launcher exposes a public `collect()`, so a vault can sweep its own fees without the creator being involved. The redirect is pointed at the vault, so fees never touch a human wallet.

Launching **without** a vault goes straight to the pons factory and fees accrue to your own wallet, as usual.

On-chain reads live in `src/lib/pons/token-state.ts` (`readTokenOnchainMetadata`, `readGraduationStatus`, `readCreatorFeeRouting`) and `src/lib/pons/vault-state.ts` (`fetchVaultState`).

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

See `.env.example`. `NEXT_PUBLIC_PONSVAULT_LAUNCHER` must point at the deployed launcher; until it is set, the launch form shows vault templates as unavailable and launches without one.

### Supabase

Supabase stores a convenience index of launches. It is not a source of truth — every row is verified against the chain before it is written, and the token page reads vault state directly from contracts.

1. Create a project at [supabase.com](https://supabase.com)
2. Run `supabase/schema.sql` in **Database → SQL Editor** (fresh setup only — it drops tables)
3. If Supabase was already live, run `supabase/rls-lockdown.sql` instead to block public writes without deleting data
4. Copy **Project URL** and **service role key** into `.env.local` and Vercel — never expose the service role key in the browser
5. Restart the dev server

**Security:** PonsVault uses Supabase **server-side only** via `SUPABASE_SERVICE_ROLE_KEY`. Do not add open RLS policies in the Supabase dashboard. If the anon key was ever used client-side, rotate it in Supabase → Settings → API and run `supabase/rls-lockdown.sql`.

Without Supabase, launches fall back to local JSON under `data/` (gitignored).

## Launch flow

1. Upload token image → pons `POST /api/ipfs/image` (via `/api/pons/ipfs`) → `ipfs://…`
2. Read launch config → factory fee, max dev buy, graduation target
3. Pick a vault template and its parameters, or choose no vault
4. Sign one transaction:
   - **With a vault** — `PonsVaultLauncher.launchWithVault()` deploys the token, deploys the vault and points the fee redirect at it
   - **Without** — `launchToken()` on factory `0xA5aAb3F0c6EeadF30Ef1D3Eb997108E976351feB`
5. Best-effort indexer registration via `/api/pons/verify`

## Keeper

A vault contract cannot wake itself up — nothing on an EVM chain can. Fees pile
up in the locker until someone sends a transaction, so without a keeper a vault
does nothing no matter how much it has earned.

The keeper is that someone. It is an ordinary wallet with a little ETH for gas,
and it holds **no authority over any vault**: `run()` has no owner and no role
gate, and the locker pays the vault directly, so funds never pass through the
keeper. Losing the keeper key costs its gas balance and nothing else, and
switching the keeper off does not strand the fees — anyone can still trigger a
run from the token page.

```bash
npm run keeper                       # one pass against KEEPER_URL
```

On Vercel, `vercel.json` schedules `/api/keeper/tick` and `CRON_SECRET`
authenticates it. Anywhere else, point cron at `npm run keeper`.

The schedule only decides how often the keeper **looks**. How often it **acts**
is set by the thresholds, and this matters more than it sounds: a run costs
about six cents of gas, so a guard that only compares value against gas holds
nothing back. Without a floor the keeper burns each trickle of fees the moment
it lands, and the burn history becomes dust instead of legible events.

Which threshold binds depends on the token. On a busy one the **interval**
does — it always has fees, so the clock sets the cadence. On a quiet one the
**floor** does, since its interval elapsed long ago. A flat floor would punish
exactly the tokens that can least afford it, leaving a slow launch showing
"nothing burned yet" for a week, so the floor drops to `KEEPER_DUST_WETH` once
a vault has gone `KEEPER_MAX_IDLE_SECONDS` without running.

The interval is measured from the vault's own on-chain `lastRunAt`, so it
survives restarts and holds even with several schedulers pointed at the same
deployment.

A creator's own `cooldown` is honoured on top, whenever it is the stricter of
the two.

## Costs

- **Launch fee**: `0.0005 ETH`
- **Optional dev buy**: dynamic cap (~0.0678 ETH today, 5% of supply)
- **Graduation**: `4.2 ETH`

## Disclaimer

Unofficial layer on pons. Not affiliated with Pons Labs. Tokens are volatile; transactions may be irreversible. A vault is not a price guarantee — it is funded by trading, so if nothing trades, nothing happens.
