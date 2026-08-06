# PonsVault → pons v2

## Status (live checks)

- Current factory: `0x7eD598BcEf8bd9Edd8C97A195C6d13f40801EC7e` (docs “Deployed addresses”).
- The earlier factory `0x7E1EAbd5…` was replaced — do not use it.
- On the current factory: `launchEnabled = true`, `canLaunch(any) = true` → **public launching is open**.
- Approved quote assets include AAPL, NVDA, TSLA, GOOGL, GME, SPY, SPCX, USDG. Native ETH / WETH still closed.
- PonsVault v1 is unchanged and still works.

## What we built

Parallel v2 stack under `contracts/src/v2/` (does not touch v1):

| Piece | Role |
|---|---|
| `PonsV2VaultLauncher` | `launchToken` → create vault → `transferCreatorFeeRecipient(vault)` |
| `PonsV2VaultRegistry` | Template → factory map |
| `PonsV2BuybackBurnVault` | Escrow harvest → `IQuoteBuyback` → burn / treasury |
| `PonsV2StakingVault` | Escrow harvest → pro-rata quote rewards to stakers |
| `PonsV2CurveBuyback` | `IQuoteBuyback` that buys on the bonding curve (pre-graduation) |
| `DeployPonsV2Vault.s.sol` | One-shot deploy script |
| `WirePonsV2Buyback.s.sol` | Upgrade live factory + set `defaultBuyback` |

RWA and Lottery v2 ports are deferred; same escrow base applies.

## Buyback helper

Vaults do not talk to Uniswap themselves. They call `IQuoteBuyback.buyback(quote, token, amount, minOut)`.

- **Pre-graduation:** `PonsV2CurveBuyback` approves the curve and calls `curve.buy(...)`, delivering tokens to the vault for burn.
- **Post-graduation:** the curve reverts with `CurveGraduated`. A Uniswap v4 helper is still TODO for that phase.

Wire the live factory (owner only):

```bash
cd contracts
forge script script/WirePonsV2Buyback.s.sol --rpc-url robinhood --broadcast
```

Then paste the printed `curveBuyback` address into `src/lib/pons/v2-deployments.ts`.

## Foundry tests

```bash
cd contracts
forge test --match-contract PonsV2VaultForkTest -vv
```

13 fork tests cover launch wiring, fee sweep → escrow, permissionless `run()` buyback/burn, full burn, staking distribute/claim, mock helper, and rejection paths. Tests launch on a **local fork only** — nothing is broadcast.

## Deployed (2026-08-06)

| Contract | Address |
|---|---|
| PonsV2VaultLauncher | `0xD948EDCDB832529bB3458B0463F5E02Bb448888e` |
| PonsV2VaultRegistry | `0xaA9C86049A258D4A076d3eF367F69C231C9746D5` |
| BuybackBurn factory | `0xdE4670A2Be85Baa3f6a2C1F6443101EA041362aB` |
| Staking factory | `0x1488473464F2C6E6c5C412f05d805c619322E7EB` |

`factory.canLaunch(launcher)` is **true**. `defaultBuyback` is still `address(0)` until `WirePonsV2Buyback` is broadcast.

## Remaining product work

1. Broadcast `WirePonsV2Buyback.s.sol` (factory owner)
2. Ship a Uniswap v4 `IQuoteBuyback` for graduated launches
3. Port RWA / Lottery templates onto `PonsV2VaultBase`
4. Token detail / trading UI for v2 curves
