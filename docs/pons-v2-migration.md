# PonsVault → pons v2

## Status (live checks)

- Current factory: `0x7eD598BcEf8bd9Edd8C97A195C6d13f40801EC7e` (docs “Deployed addresses”).
- The earlier factory `0x7E1EAbd5…` was replaced — do not use it.
- On the current factory: `launchEnabled = true`, `canLaunch(any) = true` → **public launching is open**.
- Approved quote assets include AAPL, NVDA, TSLA, GOOGL, GME, SPY, SPCX, AMD, SNDK, USDG. Native ETH / WETH still closed. Equity pairs can also be used as same-asset RWA dividends (no WETH pool required).
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
| `PonsV2RwaVault` | Escrow harvest → quote→WETH→RWA (or direct if same) → merkle rounds |
| `DeployPonsV2Vault.s.sol` | One-shot deploy script |
| `WirePonsV2Buyback.s.sol` | Upgrade live factory + set `defaultBuyback` |
| `RegisterPonsV2Rwa.s.sol` | Deploy RWA factory + register on live registry |

Lottery v2 port is still deferred; same escrow base applies.

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

`factory.canLaunch(launcher)` is **true**.

`defaultBuyback` wired 2026-08-07:

| Piece | Address |
|---|---|
| PonsV2CurveBuyback | `0x0aC10bAA445A9678F1FA29c515aa44D7513662f1` |
| Vault impl (upgraded) | `0xC3eb6aB2C79F752a64c65B8Fe3dEA80E166C1884` |

RWA Dividend registered 2026-08-07:

| Piece | Address |
|---|---|
| PonsV2RwaVaultFactory | `0xE3Dd55a527D7408d21f6Cc2aA66A488a0177C164` |
| Beacon | `0x1115f5eB8A3Edd87A12942B8cf2EEBC231ffF2e3` |
| Vault impl | `0xB7bF92d946711b4cfAC4EBE50056a0eAE837C117` |

## RWA Dividend (v2)

Fees arrive in the pairing asset. `PonsV2RwaVault` routes:

- `quote == rwaAsset` → allocate quote directly (no swap)
- `quote == WETH` → single-hop WETH → RWA
- otherwise → Uniswap V3 multihop `quote → WETH → RWA`

Register on the live registry (owner only):

```bash
cd contracts
DISTRIBUTOR=0x… forge script script/RegisterPonsV2Rwa.s.sol --rpc-url robinhood --broadcast
```

Then paste the printed factory address into `src/lib/pons/v2-deployments.ts` (`rwaFactory`).

Fork tests:

```bash
forge test --match-contract PonsV2RwaVaultForkTest -vv
```

## Remaining product work

1. ~~Broadcast `WirePonsV2Buyback.s.sol`~~ (done 2026-08-07)
2. ~~Port RWA onto `PonsV2VaultBase`~~ (registered 2026-08-07)
3. Ship a Uniswap v4 `IQuoteBuyback` for graduated launches
4. Port Lottery onto `PonsV2VaultBase`
5. Token detail / trading UI for v2 curves
