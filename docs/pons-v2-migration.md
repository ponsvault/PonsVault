# PonsVault → pons v2

## Status (live checks)

- Current factory: `0x7eD598BcEf8bd9Edd8C97A195C6d13f40801EC7e` (docs “Deployed addresses”).
- The earlier factory `0x7E1EAbd5…` was **replaced** — do not use it.
- On the current factory: `launchEnabled = true`, `canLaunch(any) = true` → **public launching is open**.
- Only **AAPL** is an approved quote asset so far (native ETH / WETH still closed).
- PonsVault v1 is unchanged and still works.

## What we built

Parallel v2 stack under `contracts/src/v2/` (does not touch v1):

| Piece | Role |
|---|---|
| `PonsV2VaultLauncher` | `launchToken` → create vault → `transferCreatorFeeRecipient(vault)` |
| `PonsV2VaultRegistry` | Template → factory map |
| `PonsV2BuybackBurnVault` | Escrow harvest → optional swapper buyback → burn / treasury |
| `PonsV2StakingVault` | Escrow harvest → pro-rata quote rewards to stakers |
| `DeployPonsV2Vault.s.sol` | One-shot deploy script |

RWA and Lottery v2 ports are deferred; same escrow base applies.

## What changes vs v1

1. **Fee intake** — locker `collectFees` → fee escrow `claimToken(quote)`.
2. **Asset** — WETH → launch quote asset (today AAPL).
3. **Launch API** — `(metadata, configId, dexId, salt)` → `(TokenParams, configId, pairToken)` + economics pin.
4. **Venue** — Uniswap v3 buyback → injectable `IQuoteBuyback` (v4 helper still to ship).
5. **Deployer gate** — same idea: launcher calls factory so `token.deployer()` is the launcher.
6. **Protocol buyback** — forced **off** on vault launches so creator share is not skimmed before escrow.

## Deployed (2026-08-06)

| Contract | Address |
|---|---|
| PonsV2VaultLauncher | `0xD948EDCDB832529bB3458B0463F5E02Bb448888e` |
| PonsV2VaultRegistry | `0xaA9C86049A258D4A076d3eF367F69C231C9746D5` |
| BuybackBurn factory | `0xdE4670A2Be85Baa3f6a2C1F6443101EA041362aB` |
| Staking factory | `0x1488473464F2C6E6c5C412f05d805c619322E7EB` |

`factory.canLaunch(launcher)` is **true** — no whitelist needed on the current factory.

## Remaining product work

1. ~~Wire the launch form to the v2 launcher~~ (done — pair picker + vault launch)
2. Ship a Uniswap v4 `IQuoteBuyback` before offering 100% burn launches
3. Port RWA / Lottery templates onto `PonsV2VaultBase`
4. Token detail / trading UI for v2 curves (currently launch + record only)

## What we still cannot do alone

- Open public launching (`launchEnabled`) — pons owner only.
- Migrate an existing token onto a v2 market — pons-operated, no public entrypoint.
