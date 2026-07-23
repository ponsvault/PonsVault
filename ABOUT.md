# About PonsVault

PonsVault is a **non-custodial launch layer** on top of [pons](https://ponsfamily.com) on **Robinhood Chain** (chain ID `4663`).

It lets anyone launch fixed-supply tokens through the same on-chain pons factory as the official app, while adding one thing pons does not do: **attaching a vault to the token at launch** so its creator fees are spent automatically by a rule nobody can change afterwards.

Your wallet signs every launch. PonsVault never holds user funds or private keys.

---

## What problem it solves

On pons, whoever launches a token receives the **creator share** of trading fees (70% on current factory launches). Those fees land in a wallet, and holders have to trust that the person behind it does something useful with them — or simply watch them get taken.

A vault removes the trust. Fees are redirected to a contract at launch, and the contract's behaviour is fixed at that moment:

- The rule and its parameters are set once. No function exists to change them later.
- Triggering the vault is **permissionless** — anyone can call `run()`, so it does not depend on the creator staying interested.
- The outcome is an ordinary on-chain transfer, so anyone can audit what the vault has actually done from chain data alone.

---

## Vault templates

| Template | Rule | Status |
|---|---|---|
| **Buyback & Burn** | Fees buy the token off the market and burn it | Available |
| **Staking** | Holders stake the token and earn fees in WETH, pro rata | Available |
| **Lottery** | Fees fund a prize pool paid to a holder each round | Planned |

Each template has its own parameters — a lottery is configured by round length and prize share, not by a burn share. Launching without a vault is also supported, in which case fees accrue to your own wallet as they normally would.

---

## How it relates to pons

PonsVault does **not** replace the pons factory. It is a frontend, a backend, and a set of vault contracts that:

1. Use the **active pons factory** (`0xA5aAb3F0c6EeadF30Ef1D3Eb997108E976351feB`)
2. Upload token images to IPFS (pons API first, Pinata fallback when pons is unreachable)
3. Submit the same **`launchToken()`** transaction your wallet would sign on ponsfamily.com — either directly, or through `PonsVaultLauncher` when a vault is attached
4. Read token and vault state **directly from chain** (metadata, pool price, graduation, fee routing, vault stats)

Launched tokens trade in the same WETH pools as any other pons launch. Graduation, pool fees, and launch protection follow pons rules.

---

## Main features

| Page | Purpose |
|---|---|
| **/** | Landing — what a vault is and how fees fund it |
| **/launch** | Create a token — form, image upload, vault template and parameters |
| **/explore** | Tokens launched **through PonsVault only** (not the full pons feed) |
| **/launchpad/[token]** | Token details — price, market cap, graduation, chart, and the vault panel |
| **/docs** | How vaults earn, parameter reference, security model, limits |

### The vault panel

On a token with a vault, the token page shows the immutable configuration, lifetime totals (harvested, burned, paid out), fees currently idle in the vault, and a **Run** button that anyone can press when the vault is ready. If the pool's price oracle has never been primed, it offers that first, since the price guard cannot work without oracle history.

---

## Why the launcher has to be the deployer

The pons locker only lets a token's **deployer** collect its creator fees. If the creator were the deployer, sweeping fees into the vault would need their signature every time, and a vault that depends on someone showing up is not automatic.

So a vault launch goes through `PonsVaultLauncher`, which deploys the token and therefore becomes its deployer. The launcher exposes a public `collect()`, which turns fee collection into something anyone can trigger. The creator is still the transaction sender, and that is what is recorded and verified as the creator.

---

## Security model

- **Immutable parameters** — no setters, so a vault cannot be retuned after people have bought in
- **TWAP price guard** — templates that trade price against a time-weighted average and revert outside configured bounds, rather than being sandwiched
- **Cooldown and minimum harvest** — a vault cannot be spammed into wasting its own fees on gas
- **Public triggers** — `run()` and `primeOracle()` take no privileged caller

---

## Tech stack

- **Next.js 16** (App Router)
- **wagmi + viem** — wallet connect and on-chain reads/writes
- **Foundry** — vault, factory and launcher contracts under `contracts/`
- **Supabase** — launch index (optional; local JSON fallback when not configured)
- **Robinhood Chain RPC** — source of truth for pricing, graduation and vault state

---

## What gets stored where

| Data | Where |
|---|---|
| Vault config, totals, run history | On-chain (vault contract) |
| Token metadata, pool, fee routing | On-chain (token + factory + locker) |
| Launch index for `/explore` | Supabase `ponsvault_launches` or `data/ponsvault-launches.json` |
| Images | IPFS (`ipfs://…` URI on token `logo()`) |

The launch index is a convenience cache only. Rows are verified against the chain before being written, and the chain wins in any disagreement.

---

## Costs (pons protocol)

- **Launch fee:** `0.0005 ETH`
- **Optional dev buy:** capped (~5% of supply)
- **Graduation threshold:** `4.2 ETH` paired in the locked WETH pool
- **Pool trading fee:** 1% (10000 fee tier)

---

## What PonsVault is not

- Not affiliated with Pons Labs or an official pons product
- Not a custodial launchpad — no depositing ETH or tokens into PonsVault
- Not a full pons explorer — `/explore` only lists PonsVault launches
- Not a price guarantee — a vault is funded by trading, so if nothing trades, nothing happens
- Not financial advice — tokens are user-created and can be volatile or illiquid

---

## Repository

- **Setup:** see [README.md](./README.md)
- **Database schema:** [supabase/schema.sql](./supabase/schema.sql)
- **Contracts:** [contracts/src](./contracts/src)

---

## Disclaimer

PonsVault is provided as-is. Review token addresses, liquidity, and transaction previews before signing. Transactions on Robinhood Chain may be irreversible.
