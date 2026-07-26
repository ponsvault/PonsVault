# PonsVault — security review

**Prepared by:** Pons Team

**Date:** 26 July 2026
**Chain:** Robinhood Chain (4663)
**Compiler:** solc 0.8.26, optimizer on, 99,999 runs
**Contracts:** 1,280 lines across `contracts/src`, all eight source-verified on
Blockscout
**Integration with V2:** possible.

---

## Summary

PonsVault routes a token's trading fees into a vault contract chosen at launch,
under rules that cannot be changed afterwards. This document records what that
guarantee rests on, which trade-offs were made deliberately, and what was found and
fixed during review.

The core guarantee holds up: **once a token is launched, its fees cannot be
redirected by anyone, including the operator.** That is enforced by the absence of
any function capable of doing it, not by a permission check — the stronger form,
because there is no key to lose or misuse.

Six issues were found during review and all six are fixed in the reviewed commit,
each covered by a regression test.

---

## Scope

Reviewed: the source code of the eight PonsVault contracts at the commit above.

| File | Lines |
|---|---|
| `PonsVaultLauncher.sol` | 162 |
| `PonsVaultRegistry.sol` | 121 |
| `factories/PonsBuybackBurnVaultFactory.sol` | 103 |
| `factories/PonsStakingVaultFactory.sol` | 99 |
| `vaults/PonsVaultBase.sol` | 145 |
| `vaults/PonsBuybackBurnVault.sol` | 146 |
| `vaults/PonsStakingVault.sol` | 331 |
| `PonsTemplates.sol`, `PonsAddresses.sol`, `interfaces/` | 173 |

**Not reviewed — operational.** Key management and custody, deployment procedure,
ownership arrangements for the registry and factories, hosting, and the off-chain
keeper's infrastructure. These are properties of how the system is operated rather
than of the code, and no statement in this document should be read as an assessment
of them.

**Not reviewed — external dependencies.** The pons launchpad, the pons locker, the
pons token implementation, Uniswap V3, and OpenZeppelin 4.9.6. PonsVault trusts all
of these and inherits any flaw in them.

**Methods not used.** Formal verification, fuzzing and invariant testing, economic
and MEV simulation beyond the reasoning under trade-offs below, and gas-griefing
analysis.

---

## What the design guarantees

**Fees can never be redirected.** The pons locker only lets a token's on-chain
deployer call `setFeeRedirect`. The launcher is the deployer of every token it
creates, and it calls that function exactly once, during the launch, in the same
transaction that creates the vault. No other code path in the launcher calls it
again. Neither the creator nor the operator can point a launched token's fees
anywhere else.

**Nobody controls when a vault acts.** `run()` has no owner, no role and no access
control. If the keeper stops running, any holder can trigger a vault from the token
page and pay the gas themselves. Automation is a convenience the operator provides,
not a dependency users take on.

**The keeper holds no authority.** It pays gas and nothing else. Losing its key
costs its gas balance and nothing more; switching it off strands no funds.

**Vaults are isolated.** One vault per token, deployed at launch, holding only that
token's fees. Nothing is pooled, so activity on one token cannot reach another
token's funds.

**A buyback leaves nothing behind.** Every run ends with zero WETH and zero tokens
in the vault. "There is nothing to withdraw" is therefore a property of the code
rather than a promise — and it makes the fee threshold a complete pacing control,
which is why the template needs no cooldown timer.

**Vault config is immutable.** Burn share, treasury and minimum harvest are written
in `initialize()` and no function assigns them again. What a creator picks at launch
is what the vault does forever.

---

## Deliberate trade-offs

Design decisions rather than oversights, listed because a reader deserves to know
they were chosen.

**The buyback has no price guard.** `run()` passes the caller's `amountOutMinimum`
straight to the router, and both the site and the keeper pass `0`. Because `run()`
is open to anyone, a caller can move the pool, trigger the vault in the same
transaction and unwind, so the vault buys badly and the burn is small.

The exposure is bounded by one batch of accrued fees: a vault cannot lose more than
it holds, and it holds only what has accrued since the last run. The `minHarvestWei`
floor therefore sets the size of the target as well as the pacing.

An earlier version compared spot price against a time-weighted average. It was
removed because it required a `primeOracle()` call plus enough trading history
before a vault could act at all — a first-run delay and a manual step that could
leave a vault stuck indefinitely if nobody pressed the button. The trade-off taken
is: act immediately at the threshold, accept a worse fill if somebody games it.
Callers wanting protection can still pass a floor, covered by
`test_callerSuppliedFloorStillApplies`.

**Vaults are beacon-upgradeable, and the registry is mutable.** Both are the
standard pattern for launchpad vaults: upgradeability lets a post-launch bug be
fixed without asking creators to migrate, and a registry lets new templates ship
without redeploying the launcher and orphaning existing tokens. Each has a
one-way renouncement — `lockUpgrades()` on the factories and `lockRegistry()` on the
registry — intended to be called once the implementations settle. A registry change
affects future launches only; it cannot reach a vault that already exists, since a
launch resolves its factory once and the vault holds no reference back.

---

## Issues found and fixed

All six are fixed in the reviewed commit.

| ID | Severity | Issue | Guard |
|---|---|---|---|
| C-1 | Critical | A creator's initial buy was credited to the launcher, which had no function able to move an ERC-20 and is immutable — permanently unrecoverable. Fixed by naming the creator as fee wallet before the launch and overwriting the fee redirect in the same transaction. | `test_devBuyReachesTheCreator`, `test_devBuyToCreatorStillLeavesFeesGoingToTheVault` |
| H-1 | High | `collect()` is public, so anyone could make the locker pay a staking vault directly; the next `run()` then found nothing to harvest, reverted, and left the WETH owed to nobody and unreachable. Fixed by distributing the vault's full unencumbered balance. | `test_feesCollectedOutOfBandStillReachStakers` |
| H-2 | High | A staker could claim the same rewards repeatedly, because settlement credited what was owed without advancing the reward-debt baseline. | `test_claimingTwicePaysOnce` |
| M-1 | Medium | Reward precision loss stranded roughly 1e8 wei per run at `PRECISION = 1e18` against a staked supply near 1e26. Fixed by raising precision to `1e27` and requiring a minimum stake. | staking suite |
| M-2 | Medium | A factory returning the zero address would have redirected fees to it irrecoverably. Fixed with an explicit `VaultNotCreated()` check. | launcher suite |
| L-1 | Low | Off-chain launch verification compared the deployer against the user's wallet, but for a vault launch the deployer is the launcher. | launch-registry tests |

Two known inaccuracies remain in read-only helpers and are worked around rather
than relied on: `canRun()` reads balances before the harvest and so reports
"insufficient fees" in the normal case of fees waiting in the locker, and
`totalWethHarvested` undercounts when fees arrive via a separate `collect()`.
Neither affects funds. The UI and keeper simulate `run()` instead of trusting
`canRun()`, and the undercounted statistic is not displayed. Both are scheduled for
the next implementation upgrade.

---

## Areas examined without findings

**Reentrancy.** External calls go to the pons locker, the Uniswap router, WETH and
the token itself. State is written before external calls in the paths reviewed, and
the staking vault settles before transferring. No issue identified — which is not
the same as proving none exists, and is where fuzzing would add most.

**Staking accounting.** The staked token is also a reward token, so `balanceOf`
mixes principal, undistributed fees and credited rewards. Every quantity is tracked
separately (`totalStaked`, `tokenReserved`, `wethReserved`), which is what prevents
one staker withdrawing another's principal. H-2 was a bug in this area, so it
warrants the most scrutiny in any follow-up review.

**Access control.** Every privileged function was examined against the question of
what its holder could take. `run()`, `collect()` and the harvest path carry no
privilege at all.

---

## Testing

45 tests, 39 of them forked against live mainnet state rather than mocks.

| Suite | Tests |
|---|---|
| `PonsBuybackBurnVault.fork.t.sol` | 11 |
| `PonsStakingVault.fork.t.sol` | 11 |
| `PonsVaultLauncher.fork.t.sol` | 12 |
| `VaultConfigDecoding.t.sol` | 6 |
| `WebsiteLaunch.fork.t.sol` | 5 |

Two checks cover ground a conventional suite cannot. `scripts/audit-abi-seam.mjs`
diffs every hand-written TypeScript ABI against the compiled contracts, and
`WebsiteLaunch.fork.t.sol` takes the literal calldata the launch form produces and
**executes it against the launcher that is actually deployed**, asserting the vault
receives the config that was typed into the form.

Forge only speaks Solidity and the app only speaks TypeScript, so a wrong selector,
a mis-encoded config, or a launcher address the frontend never followed would look
healthy from inside either suite alone. C-1 is the bug that motivated building this.

---

## Recommendations

1. Call `lockUpgrades()` and `lockRegistry()` once the implementations settle. Until
   then the immutability guarantee rests on operator conduct rather than on code.
2. Fix the two read-only inaccuracies on the next implementation upgrade, before
   locking.
3. Add fuzz and invariant tests, particularly for the staking vault: no staker can
   withdraw more than they staked plus their share, and `tokenReserved +
   totalStaked` never exceeds the balance.
4. Commission an independent professional audit before the system holds meaningful
   value. Nothing in this document substitutes for one.

---
