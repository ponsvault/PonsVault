# PonsVault — project overview

How the pieces fit together, why they are shaped that way, and what is still
missing. `README.md` covers setup and `ABOUT.md` is the product pitch; this is
the engineering map.

---

## 1. What this is

A vault layer on top of [pons](https://ponsfamily.com), the token launchpad on
Robinhood Chain (4663).

Launch a token on pons normally and its trading fees accrue to whoever deployed
it, claimable at any time. PonsVault replaces that wallet with a **vault
contract chosen at launch**: the fees are routed into a contract with fixed
rules that nobody — not the creator, not us — can redirect or withdraw
afterwards.

Buyback & Burn is the first template, not the product. The product is the
ability to pick a rule and have it be permanent.

---

## 2. The one architectural trick everything rests on

pons' locker only accepts `collectFees(token)` **from the token's deployer**.

That single rule is why a naive "just point fees at a contract" design fails: a
vault could be named as the fee recipient, but only the creator's wallet could
ever trigger the sweep, so every burn would depend on the creator showing up.
Automation would require every creator's private key.

The fix is to make a contract the deployer:

```
user ──signs one tx──▶ PonsVaultLauncher.launchWithVault(…, templateId, configBytes)
                          │
                          ├─ registry.factoryFor(templateId)   ← fails early if unknown
                          ├─ sets metadata.feeWallet = launcher (itself)
                          ├─ pons launchpad.launchToken()  ← launcher is now the deployer
                          ├─ factory.createVault(token, locker, configBytes)
                          └─ locker.setFeeRedirect(token, vault)
```

The launcher is the deployer, so only the launcher may call `collectFees`. Its
`collect()` has **no access control**, so in practice anyone may. Funds never
touch the launcher: the locker pays the fee redirect, which already points at
the vault.

Three consequences follow, and most of the design is downstream of them:

- **Anyone can trigger a vault.** No keys, no roles, no permission.
- **Nobody can redirect the fees.** `setFeeRedirect` is called once during
  launch and there is no code path that calls it again.
- **A single keeper can service every vault**, because it needs no authority.

---

## 3. Contracts

`contracts/src/`

| File | Role |
|---|---|
| `PonsVaultLauncher.sol` | Launch entry point, token deployer, permissionless `collect()` |
| `PonsVaultRegistry.sol` | `templateId → factory`; the only thing that changes when a template ships |
| `PonsTemplates.sol` | Canonical template ids as `bytes32` |
| `interfaces/IPonsVaultFactory.sol` | The shape every template's factory must have |
| `factories/PonsBuybackBurnVaultFactory.sol` | Beacon proxy factory, `vaultOf(token)` index |
| `factories/PonsStakingVaultFactory.sol` | Same, for staking vaults |
| `vaults/PonsVaultBase.sol` | Shared: harvest, buyback, burn |
| `vaults/PonsBuybackBurnVault.sol` | Template 1: config, `run(minOut)`, `canRun()` |
| `vaults/PonsStakingVault.sol` | Template 2: stake/unstake/claim, `run()` |
| `PonsAddresses.sol` | Chain constants |
| `interfaces/` | pons launchpad, pons locker, Uniswap V3 |

A token gets exactly one vault, chosen at launch and permanent. Every vault
exposes `template()` returning the same id the frontend uses (`buyback-burn`,
`staking`) — the templates have different configs and different `run()`
signatures, so anything holding only a vault address has to ask before it can
decode anything else.

### Why the launcher knows nothing about templates

The launcher is the on-chain deployer of every token it creates, and those
tokens depend on it to sweep their fees forever. It therefore can never move —
which rules out the obvious design of a typed `launchWithXVault` per template,
since each one would mean a new launcher address and orphan everything behind
the old one.

So the launcher takes a `bytes32 templateId` and an opaque `bytes` config, and
asks a `PonsVaultRegistry` which factory to use. The factory decodes the config
into its own struct. Shipping a template is then:

```
1. write the vault + its factory
2. deploy the factory
3. registry.register(bytes32("lottery"), factory)   ← one transaction
```

No launcher redeploy, no env var change, no migration, and tokens launched
earlier are untouched. `test_newTemplateNeedsNoLauncherRedeploy` pins this down.

What it costs:

- **Type safety at the boundary.** A malformed config reverts in `abi.decode`
  inside the factory rather than at the ABI layer. Values are still validated by
  the vault itself, so nothing unsafe gets through — the error is just less
  specific.
- **A trust surface.** The registry owner picks which factory a template id
  resolves to, so a malicious registration would send *new* launches to a vault
  the owner controls. It cannot touch a vault that already exists: a launch
  resolves the factory once, and the resulting vault holds no reference back to
  the registry. `lockRegistry()` renounces the ability to change the set at all,
  which is the endgame once the templates settle.
- **`retire(templateId)`** stops new launches choosing a template without
  disturbing the vaults already running under it.

### What `run()` does — Buyback & Burn

Permissionless, and the whole template in five steps:

1. `_harvest()` — call `collector.collect(token)`, sweeping the locker into the
   vault. Arrives as WETH **and** the token itself, since a V3 position accrues
   fees on both sides.
2. Revert if the swept WETH is under `minHarvestWei`, or is zero.
3. `wethSpent = balance × burnBps / 10000`.
4. `_buyback()` then `_burnAllTokens()` — swap WETH→token, then send the vault's
   **entire** token balance to `0x…dEaD`. "Entire" matters: it burns the bought
   tokens and the harvested token-side fees together, and the latter never
   needed a swap.
5. Any remainder goes to the treasury, only when `burnBps < 100%`.

The vault ends every run holding zero WETH and zero tokens. That is what makes
"nothing to withdraw" a fact about the code rather than a promise.

### There is no price guard, and that is a choice

The swap runs at whatever the pool quotes in that block. `run()`'s
`amountOutMinimum` is passed straight to the router and is the only protection
available; the site and the keeper both send `0`.

Because `run()` is open to anyone, this is directly exploitable: move the pool
up, call `run(0)` in the same transaction, and unwind. The vault spends its full
balance and receives very little, and the burn is dust. The loss per attempt is
bounded by one batch of accrued fees, so `minHarvestWei` sets the size of the
target as well as the pacing.

This was removed deliberately, in favour of buying the moment the threshold is
hit with no warm-up period and nothing for the creator to configure. The
previous design compared spot against a TWAP over a configurable window, which
required `primeOracle()` to grow the pool's observation buffer and then enough
trading history to fill it — a first-run delay and a manual step that could
strand a vault indefinitely if nobody pressed the button.
`test_callerSuppliedFloorStillApplies` pins down that the opt-in floor still
works for a caller who wants it.

### Why there is no cooldown

Step 5 spends the entire balance, which makes step 2 a complete pacing control
on its own: a run cannot repeat until trading has refilled the vault past the
floor. A timer would only duplicate that, and worse — it paces by the clock
rather than by volume, so a busy token waits for no reason and a quiet one still
burns dust the moment its timer expires.

One consequence is worth knowing: a buyback's own swap pays pool fees, which
accrue straight back to the position. A vault with a negligible floor really can
run back to back off its own exhaust. The floor is what makes the pacing mean
something, which is why the form defaults it rather than leaving it at zero.
`test_balanceBelowFloorCannotRun` and `test_runSpendsEverythingItHolds` pin both
halves of this down.

### Config, fixed forever at launch

`burnBps`, `treasury`, `minHarvestWei`. Written in `initialize()` and never
assignable again.

### What `run()` does — Staking

Holders deposit the token into the vault; fees are paid out to them pro rata as
WETH. `run()` harvests exactly as above, then credits every staker via the
standard `accRewardPerShare` accumulator. No swap, so no price exposure at all —
there is nothing here to bait.

Config is `lockPeriod` and `minHarvestWei`. Rewards accrue in **two**
currencies, because that is how the fees arrive: WETH plus whatever the pool
earned on the token side.

Three things about this template are worth knowing before touching it.

**It is staking, not holder dividends.** Paying every holder passively would
need the token to call the vault on each balance change. pons tokens are plain
ERC-20s whose fees come from the Uniswap pool rather than a transfer tax, so
there is no hook to attach to. An explicit deposit is what makes the payout
computable. (Flap can do passive dividends because their tokens are tax tokens
with logic inside `transfer()`.)

**The staked token is also a reward token.** `balanceOf` therefore measures
nothing useful here — it mixes staked principal, undistributed fees, and
credited-but-unclaimed rewards. Every quantity is tracked explicitly
(`totalStaked`, `tokenReserved`, `wethReserved`), and `unencumberedBalances()`
is what a UI should show as "queued". Getting this wrong lets one staker
withdraw another's principal.

**`run()` reverts when nobody is staked**, which is deliberate. The revert rolls
the harvest back too, so the fees stay unclaimed in the locker rather than
stranded in the vault, and the first run after someone stakes collects the whole
backlog for them.

Two smaller guards: `PRECISION` is `1e27` rather than the usual `1e18`, because
staked supply runs to ~1e26 and each of the two divisions between a distribution
and a staker's balance truncates by up to `totalStaked / PRECISION` wei — at
1e18 that stranded ~1e8 wei per run. And a non-zero position must be at least
`MIN_STAKE` (0.001 token), which bounds how far the accumulator can jump in one
step and keeps the fixed-point maths clear of overflow.

### Upgradeability — the one real power

Vaults are beacon proxies. The factory owner can call
`upgradeVaultImplementation()`, which changes the logic of **every existing
vault at once**, and `lockUpgrades()`, which gives that up permanently.

This is the only meaningful authority in the system and it undercuts the
immutability claim until it is locked. Treat it accordingly.

---

## 4. Two known contract-level flaws

Both are worked around in the frontend and keeper today. Neither is urgent, but
both should be fixed on the next implementation upgrade.

**`canRun()` is a stale predictor.** It reads `idleBalances()`, which only sees
WETH already swept into the vault, while `run()` harvests *first*. So it reports
"Insufficient accrued fees" in precisely the normal case — fees waiting in the
locker. Its own reason string admits this ("harvest may still be pending in the
locker"). Anything asking "is this runnable?" must simulate `run()` instead;
both the UI and the keeper now do.

**`totalWethHarvested` undercounts.** It only increments inside `_harvest()`, so
WETH that arrives via a separate `collect()` call is invisible to it. It was
showing 0.0036 WETH against roughly 0.027 actually spent. The stat is no longer
displayed rather than displayed wrongly.

---

## 5. Frontend

Next.js 16 (App Router), React 19, wagmi + viem, TanStack Query, Tailwind 4.
Design language is restrained and left-aligned, drawn from linear.app: hairline
borders, small radii, one easing curve, no gradients or glow.

```
src/app/            /  /explore  /launch  /launchpad/[token]  /docs
src/app/api/        server routes (see below)
src/app/styles/     primitives.css, home.css, explore.css, docs.css,
                    app-surface.css (overrides legacy launchpad CSS)
src/components/     launch-form, explore-grid, token-detail,
                    token-vault-panel, token-creator-fees-panel, vault-panel
src/lib/pons/       chain, client, launch, vault, vault-state, pricing,
                    token-detail, explore-enrichment, creator-fees
src/lib/keeper/     run-vaults
src/lib/launch-registry/  store, types, verify-launch-record
```

### Gross vs net — a recurring source of confusion

pons splits pool fees **70% creator / 30% protocol**. The vault only ever
receives the creator share. So the Creator fees panel ("Accrued WETH") shows
gross while the vault panel ("Queued for the next burn") shows net, and the two
sit next to each other differing by 30%. Anything new that displays a fee figure
should say which it is.

---

## 6. Keeper

**Nothing on an EVM chain can wake itself up.** A vault holds fees until someone
sends it a transaction. Without a keeper, a vault does nothing no matter how much
it has earned — which is exactly what happened to the first test token, sitting
on $40-80 of fees having burned once.

Flap solves this the same way, and their docs say so plainly: a "Flap Tax Trigger
Bot monitors balances and calls `dispatch()` when economically viable", with
"anyone can call dispatch() if they want to pay the gas". Their vaults' buyback
function is gated behind a role; ours is open to anyone, so on the trust axis
ours is the stronger version. (Flap also has a second trigger we structurally
cannot copy: their tokens are *tax tokens* that self-trigger inside `transfer()`.
Our tokens are plain ERC-20s with no hook, so an external trigger is the only
option short of leaving the pons rails.)

### Design

- `src/lib/keeper/run-vaults.ts` — the logic
- `GET /api/keeper/tick` — authenticated by `CRON_SECRET` or `KEEPER_SECRET`
- `scripts/keeper-tick.mjs` (`npm run keeper`) — drives the route over HTTP
- `vercel.json` — cron every 5 minutes

Two audit scripts cover the seams the test suites structurally cannot see, since
forge only ever speaks Solidity and the app only ever speaks TypeScript:
`scripts/audit-abi-seam.mjs` diffs every hand-written TS ABI against the compiled
contracts, and `scripts/audit-config-bytes.ts` prints the real calldata the launch
form produces, which `test/VaultConfigDecoding.t.sol` then decodes with the
factories' own types. Regenerate the literals in that test whenever a Config
changes.

Readiness is decided by **simulating `run()`**, never by `canRun()` (§4). A
simulation answers the only question that matters: would this succeed, and what
would it do.

Vaults are found **two ways, merged by token**: the `ponsvault_launches` table,
and the launcher's own `Launched` events. The table alone was a silent single
point of failure — a launch that succeeded on-chain but failed to record left a
working vault that no keeper would ever touch, accruing fees forever with nothing
to spend them. The event scan runs from genesis in well under a second, since a
launcher emits one event per launch; `PONSVAULT_LAUNCHER_START_BLOCK` narrows it
if that changes. A failed scan returns empty rather than failing the tick, so the
safety net cannot become a new dependency.

The keeper wallet holds **no authority**. It pays gas and nothing else. Losing
the key costs its gas balance; switching it off strands nothing, because anyone
can still trigger a run from the token page.

### Thresholds, and why they exist

A run costs about **$0.06** of gas, so economics are never the binding
constraint — a $2 burn already pays for itself 30 times over. The thresholds are
about **legibility**: fees trickle in continuously, and unthrottled the keeper
burns whatever landed in the last few minutes, turning the burn history into
dust. The first unthrottled version fired four times in ten minutes, the last of
them burning $1.

| Variable | Default | Purpose |
|---|---|---|
| `KEEPER_MIN_INTERVAL_SECONDS` | 300 | per-vault backstop; matches the cron interval |
| `KEEPER_MIN_WETH` | 0.025 (~$47) | the real control — matches the form's default |
| `KEEPER_MAX_IDLE_SECONDS` | 86400 | how long a vault may sit under the floor |
| `KEEPER_DUST_WETH` | 0.002 (~$4) | the floor once overdue |
| `KEEPER_MIN_VALUE_RATIO` | 3 | never spend more on gas than it is worth |

The idle window exists because a flat floor punishes the tokens that can least
afford it: a slow launch would show "nothing burned yet" for a week, on the page
where someone is deciding whether the vault does anything. A vault that has never
run counts as overdue immediately.

The interval is measured from the vault's on-chain `lastRunAt`, so it is
stateless — restarts and multiple schedulers cannot double-fire. It is kept at the
cron interval for that reason: `lastRunAt` only moves once a run confirms, so two
ticks overlapping inside one window would both read the old value.

`KEEPER_MIN_WETH` and the launch form's `minHarvestEth` default are deliberately
the same number. Both floors apply and the higher one decides, so a lower form
default would show creators a threshold that does not actually pace their vault.
Change one and change the other.

None of this constrains the **manual** button, deliberately. Gating that would
mean someone controls when fees get burned, which is the guarantee the design
exists to provide.

---

## 7. Data

Supabase, one table: `ponsvault_launches` (`supabase/schema.sql`). Falls back to
a JSON file when Supabase is not configured.

The launch record is written by `POST /api/launches/record` **after**
verification against the chain, and the `vault` column is resolved server-side
via `launcher.vaultOf(token)` rather than trusted from the client.

`verify-launch-record.ts` had to learn that a vault launch's on-chain deployer is
the *launcher*, not the user — otherwise every vault launch fails verification.

Burn stats on `/explore` are read live per token in `explore-enrichment.ts`, not
stored.

---

## 8. Deployed (TEST ONLY)

Chain 4663. **The factory owner is a private key that has been publicly exposed.
This stack must be redeployed before any real use.**

These addresses predate the registry, so they are already stale: the launcher
below still has the old two-factory constructor. The redeploy that introduces
`PonsVaultRegistry` should be the last one the launcher ever needs — after it,
templates are registered rather than compiled in. SBX loses its vault panel at
that point, since a fresh launcher has no record of it and the old buyback
factory is not registered in the new registry. It is a throwaway test token; the
alternative is carrying legacy plumbing permanently for one row.

| | |
|---|---|
| PonsVaultLauncher | `0xFEd8eac01b1dDD38C0EF4ae7b626Ce135Eba643B` |
| BuybackBurnVaultFactory | `0xAf4Cfd177BAe183DA98774f7408F9A57c820b204` |
| Vault beacon | `0x621E3c3AF5165E914D6CCac028Acb167e361Fdeb` |
| Factory owner | `0xCD0875124415A61D0d9082496AE8e88c2d55a642` ⚠️ exposed |
| pons locker | `0x736D76699C26D0d966744cAe304C000d471f7F35` |
| pons factory | `0xA5aAb3F0c6EeadF30Ef1D3Eb997108E976351feB` |
| WETH | `0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73` |

Test token **SBX (Sandbox)** — `0xa84b9f3b386a4875e524a0c35a4569ce85a1d083`,
vault `0x97BC2F82E978C373e9a3a25Cae751e7E9CfAbd15`. Launched via
`contracts/script/TestLaunch.s.sol`, which hardcodes `minHarvest = 0` — far more
aggressive than the launch form's default of 0.025 ETH. That is why it behaved
so eagerly; it is not representative.

This stack predates the removal of `cooldown` from both `Config` structs, so its
vaults are the old shape and the addresses above are stale. The whole set needs
redeploying before launch.

---

## 9. Templates

| Template | Status |
|---|---|
| Buyback & Burn | shipped |
| Staking | built and tested, not yet deployed |
| Lottery | not started — see below |

**Staking** is written, covered by eleven fork tests, and wired end to end through
the launch form, token page, keeper and explore cards. It has never been
deployed or launched against; it goes live with the registry redeploy.

One bug worth remembering, found by auditing it against the buyback rather than
by any test. `run()` used to distribute what its own harvest returned. But
`PonsVaultLauncher.collect` is public, so anyone can make the locker pay a vault
without going through `run()` — after which the harvest returns nothing, `run()`
reverts with `NothingToHarvest`, and the money sits in the vault owed to nobody,
unreachable by any later run. Free to trigger, repeatable, and permanent. It now
distributes {unencumberedBalances} instead, which is what the buyback always did
with `idleBalances()`. `test_feesCollectedOutOfBandStillReachStakers` guards it.
The fix also aligned the contract with the UI, which was already reading
`unencumberedBalances` as "queued for the next payout".

Everything after Staking is a factory deployment plus one `register()` call —
`script/RegisterVaultTemplate.s.sol` does both halves of the second step.

**Lottery** needs a fair way to pick a winner before it can ship. The vault's
`run()` is permissionless — anyone can call it — which breaks the obvious
approaches:

- **Block hash as randomness:** the caller chooses *when* to send the
  transaction. They simulate the outcome first and only broadcast when they
  would win. The prize pool drains to whoever runs a bot, not to a random holder.
- **No VRF on this chain:** there is no Chainlink VRF or equivalent to draw from
  trustlessly.

What would work is something like **commit–reveal** (someone commits to a secret,
waits a block, then reveals it — two steps, awkward UX) or an **off-chain randomness
oracle** you have to trust. There is also a product question: a lottery may count
as gambling in some jurisdictions. Until that design is settled, Lottery stays
off the roadmap as an active build.

---

## 10. What is not done

**Blocking any real launch**

- Redeploy the factory and launcher from a key that is not compromised;
  ideally a multisig, then `lockUpgrades()` once the implementation settles.
- Host the keeper. It currently runs only from a local machine.
- Nothing is deployed. No hosting, no domain, no cron.

**Known gaps**

- `canRun()` and `totalWethHarvested` (§4) — fix on the next upgrade.
- Contracts are unverified on Blockscout (deliberately, to keep the branding off
  a throwaway deployment).
- The deployed launcher predates staking, so the current test stack cannot
  launch one. Redeploying orphans the SBX vault (the new launcher's
  `vaultOf(SBX)` returns zero, so its panel disappears).
- Two of four templates still unavailable.
- No tests for the keeper.
