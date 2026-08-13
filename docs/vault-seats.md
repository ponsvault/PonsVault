# Vault Seats — overview

What a seat series is, how the money moves, and where the code lives. `project_overview.md` is the
map for the vault templates; this is the same thing for Seats. Written to be read by a buyer, a
developer, or an assistant that has to change something here without breaking it.

---

## 1. What it is

A **seat series** is an NFT collection with an economy attached. One transaction deploys the
collection, a token that prices it, a shop that trades it, a reward pot, and a loan book — all of
them permissionless contracts that nobody can redirect afterwards.

The short version of the loop: you buy fuel, you spend fuel on a seat, you pay a small amount of
fuel to activate the seat, and from then on the seat earns a share of every fee the series collects.
The earnings land in a wallet the NFT itself owns, so they travel with the seat when you sell it.

Two things make it worth building rather than forking a mint page:

- **The fee engine is the product.** Every ETH fee a trade pays goes to the reward pot, and the pot
  pays out to seats that are switched on. There is no protocol cut on trades.
- **Every seat owns a wallet.** Rewards do not sit in a claim contract keyed by address; they sit in
  an account bound to the token id. Sell the seat and the balance goes with it.

Live on Robinhood Chain (4663).

---

## 2. The buyer's loop

1. **Get fuel.** Each series runs on an ERC-20 — its "fuel", launched on a pons v2 bonding curve in
   the same transaction that creates the series, so buying fuel is one swap against ETH or the
   pair token. The factory also accepts an ERC-20 that already exists, or mints a fresh one to the
   creator, but the desk exposes neither: every series created through the UI launches a curve.
2. **Buy a seat.** `Buy next` takes the lowest unsold seat. `Snipe #n` takes one specific seat,
   whether it was never minted or was sold back. Same fuel price either way; sniping costs more ETH.
   The NFT is minted at the moment of purchase, so a buyer pays the gas for their own seat.
3. **Wait for the reveal**, if the series sells sealed. See §6.
4. **Activate.** Pay a tiered fuel fee to put the seat on the payroll. Selling or transferring clears
   activation; the next owner has to activate again.
5. **Get paid.** When the pot passes its threshold, anyone can open a round. Activated seats split it
   by tier weight, delivered into each seat's own wallet.
6. **Borrow, optionally.** Lock the seat for fuel and repay later, or sell it back to the shop.

## 3. The creator's loop

Everything happens at `/seats/create`: name, ticker, art, supply, and the seat price in fuel. The
fuel launch, the creator's first buy and the series all happen inside one transaction, so it is a
single wallet confirmation — on any wallet, not just ones that batch. Only an ERC-20 pair adds a
second prompt, for the approval.

A creator sets the parameters and then has no privileged position: no mint function, no fee switch,
no pause. The one thing left to them is revealing the art, and even that is open to anyone once the
commitment allows it.

---

## 4. What a series is made of

Six contracts, deployed by `PonsSeatSeriesFactory.createSeries` in a single call and recorded in
`PonsSeatSeriesRegistry`.

| Contract | What it does |
| --- | --- |
| `PonsSeatCollection` | The ERC-721. Fixed supply, minted on purchase, one bound wallet per seat, sealed metadata until reveal. |
| `PonsSeatAmmVault` | The shop. Flat fuel price per seat, buy / snipe / sell, the only contract allowed to mint. |
| `PonsSeatActivationManager` | The payroll. Holds tiers, weights, and which seats are switched on. |
| `PonsSeatDirectedBooster` | The pot. Collects ETH fees, opens rounds, pays seats. |
| `PonsSeatLoanVault` | The loan book. Fuel against a locked seat, with liquidation after the term. |
| `PonsSeatTbaRegistry` + `PonsSeatAccount` | Shared infrastructure. Derives and deploys each seat's wallet. |

Fixed parameters, set in `src/lib/seats/create-series.ts` so the desk and any script agree:

| Parameter | Value |
| --- | --- |
| Supply ceiling | 4,444 (Originals is fixed at 1,111) |
| Trade fee | 10% buy, 10% sell, 15% snipe — of the seat's ETH value |
| Fee floor | The same rates against a 0.01 ETH seat: 0.001 / 0.001 / 0.0015 ETH |
| Royalty | 3.33%, to the protocol treasury |
| Activation tiers | 66,666 / 166,666 / 666,666 fuel |
| Tier weights | 10,000 / 12,500 / 20,000 |
| Round threshold | 0.05 ETH in the pot |
| Loan principal | 70% of the seat's shop price, in fuel |
| Loan term | 7 days |
| Loan fee | 0.001 ETH, the same as buying a seat |

### Seats are minted on purchase

Minting 1,111 seats at creation cost about 230k gas each, which put a full series past what any node
will simulate. Now creation is a flat cost whatever the supply, and each buyer pays for their own
seat. `mintNext` walks past ids already taken by a snipe; `mintSpecific` covers the snipe itself.

### Seat wallets

Each seat's wallet address is derived with CREATE2 the moment the series exists, so it can receive
ETH before any code is deployed to it. Deployment happens on first use and anyone can pay for it.
This was the other half of the gas problem: deploying 1,111 accounts eagerly was most of the old
per-seat cost.

---

## 5. Where the money goes

**Trades.** Every buy, sell and snipe carries ETH on top of the fuel price. All of it goes to the
booster pot; no protocol share is taken. The contract cannot price a seat — the price is in fuel and
fuel trades on a curve it has no handle on — so it enforces the percentage against a 0.01 ETH
notional as a floor, and the desk quotes the real number off the curve. Reading that 0.01 as the fee
rather than as the notional charges ten times too much, which is exactly the bug the loan fee had
until it was fixed.

**Loans.** The ETH fee splits 70% to the pot, 30% to the protocol treasury. The principal is 70% of
the seat's shop price, so a liquidator who pays the principal buys the seat at a 30% discount, and
the vault is made whole either way.

**Rounds.** A round freezes its share table the second it opens. Seats activated in that same second
or later are not in it — they are in line for the next one — which is why upgrading a tier re-dates
the seat. Unclaimed rounds roll back into the pot after 7 days.

**Nothing is stranded.** Fees sit in the pot until a round is opened, then in a seat's wallet until
its owner withdraws. `scripts/recover-test-funds.ts` walks that path for throwaway test series, and
is a working reference for how the pieces connect.

---

## 6. Art, and the sealed sale

A series either brings **one image** for every seat, or uses **PonsVault Originals**: twelve animals
in eight light grades, dealt by exact allocation — 333 Golden Hour, 222 Sunrise, 178 Overcast, 155
Dusk, 111 Moonlit, 56 Ash, 44 Aurora, 11 Prism, and one 1-of-1 that sits outside the grid entirely.
The artwork is pinned once and shared; only the per-series metadata folder is written at launch.

An Originals series **sells sealed**, and it has to, for two reasons that only bite together:

- The metadata is pinned before the first sale, so a public pack is readable by anyone.
- `snipe(tokenId)` buys an exact seat. Together those turn the 1-of-1 from something you win into
  something you buy on purpose for the price of a 15% fee.

How sealing works:

1. The shuffle takes a **random per-series salt**, so the layout cannot be regenerated from the name
   and ticker even though the algorithm is public. The salt never leaves the server.
2. The collection is created with a **placeholder URI** every seat returns, plus `provenanceHash` —
   `keccak256` of the real base URI. The pack is therefore fixed before anything is sold.
3. `reveal(baseTokenURI)` accepts only a URI matching that hash. It is **permissionless**: the hash
   is the gate, so there is nothing to gain by front-running it and nothing lost if the creator
   disappears.
4. It unlocks on **sellout, or 7 days after creation**, whichever comes first, so a series that never
   sells out still gets its art. Marketplaces are told to re-read metadata with ERC-4906.

The real folder is recovered at reveal time by looking up the pin labelled with that same commitment,
and `/api/seats/reveal` only hands it over once the chain agrees the sale is over.

A single-image series has no layout to hide, commits nothing, and is revealed from the first sale.

---

## 7. Creating a series in one transaction

A series has to point at fuel that already exists, so creating one is naturally two calls. Wallet
batching (EIP-5792) can sign two calls as one confirmation, but only on chains the wallet has
enabled it for — MetaMask, for instance, lists the chains it supports and Robinhood Chain is not
among them — so in practice creators were confirming twice.

`PonsSeatLauncher` does both inside a single contract call instead: it launches the fuel, buys the
creator's first fuel on the curve it just created, and calls `createSeries` with the real address.
One confirmation on every wallet, and either all of it happens or none of it does, so there is no
half-finished launch to recover from.

Nothing that carries rights is attributed to the launcher. It points the fuel token's
`creatorFeeRecipient` at the caller, sends the first buy to them, and creates the series through
`createSeriesFor`, which the factory accepts from this one address so the registry records the
person who paid rather than the contract they went through. `npm run seats:check-batch` runs the
whole thing on a fork and asserts each of those.

The one field that cannot follow is pons' `deployer`, which is set to whoever calls `launchToken`.
`launchTokenFor` can name someone else but reverts unless the caller is the single `launchForwarder`
the pons owner configures, so no third-party contract can hand deployer status back to a user. It
costs nothing in practice: the factory stores `deployer` and never checks it, fees are escrowed to
the creator fee recipient and claimed by that address, and both `transferCreatorFeeRecipient` and
`setBuybackEnabled` are gated on the recipient too. Because the label would otherwise be misleading,
the token page credits the creator instead whenever the deployer is the seat launcher.

---

## 8. Mainnet addresses

Kept in `src/lib/seats/deployments.ts` and replaced as a set, never one at a time — the registry only
lets its current factory repoint it.

| Piece | Address |
| --- | --- |
| Launcher | `0x09D31B19DDd35Bf5864BbFD79a811AFc1caccB89` |
| Factory | `0xBF397C95ABa08d174F0FB60bAa3D0F2101265a9c` |
| Registry | `0x278FFA5A46283A05635A3d33d820D9Cc7D7E67E2` |
| TBA registry | `0xBcEFd591F0475Ea575bdd20Ea68f177638D2e33c` |
| Account implementation | `0xAa73f9fb620F61B3773687F0fbf4F8957b75B99f` |
| Core deployer | `0x684538b603b4c58ccd4e68C072A64212aA143f32` |
| Market deployer | `0x4503C83d537e90321F076FE98AD6E777d03d7D2b` |

---

## 9. Code map

**Contracts** — `contracts/src/seats/`

```
PonsSeatLauncher.sol             fuel launch + first buy + series, in one transaction
PonsSeatSeriesFactory.sol        one call, whole series; CreateParams is the public surface
PonsSeatSeriesCoreDeployer.sol   collection + fuel + activation
PonsSeatSeriesMarketDeployer.sol booster + shop + loan vault
PonsSeatCollection.sol           ERC-721, lazy mint, sealed metadata, reveal
PonsSeatAmmVault.sol             buy / snipe / sell, fee to the pot
PonsSeatActivationManager.sol    tiers, weights, activation cleared on transfer
PonsSeatDirectedBooster.sol      pot, rounds, delivery
PonsSeatLoanVault.sol            borrow / repay / liquidate
PonsSeatTbaRegistry.sol          CREATE2 address for a seat's wallet
PonsSeatAccount.sol              the wallet itself
```

The two deployers exist only because the factory would otherwise blow EIP-170. The core deployer
currently has **145 bytes of headroom**, so anything added to `PonsSeatCollection` will need it split
further.

**App** — `src/lib/seats/`

```
create-series.ts   the CreateParams struct and every default; one source of truth
fuel-launch.ts     builds the launcher call, and the plain createSeries call for scripts
fees.ts            what a trade costs, priced off the fuel curve, floors and caps
originals.ts       the deck, the rarity table, the salted shuffle
originals-pack.ts  pins a pack, commits to it, pins the sealed card
metadata-upload.ts the bring-your-own-image path
pinata.ts          pinning, labelling a pin, finding one by its label
deployments.ts     mainnet addresses
abis.ts            every ABI the app reads or writes
read.ts / types.ts loading a series for a page
```

UI: `src/components/seats-create-form.tsx` (creation), `src/components/seats-series-desk.tsx` (the
tabbed desk: Trade / My seats / Activate / Distributions / Loans), `src/app/seats/`.

API: `/api/seats/originals` builds a sealed pack, `/api/seats/metadata` pins a single-image pack,
`/api/seats/reveal` hands out the committed folder once the chain says the sale is over.

---

## 10. Testing

Nothing here needs mainnet except the last one.

| Command | What it proves |
| --- | --- |
| `cd contracts && forge test` | 164 tests: the whole lifecycle, the fee maths, round eligibility, the sealed sale, the launcher against the real pons factory |
| `npm run seats:check-batch` | The exact call the Create button builds, on a fork: one prompt on ETH, two on an ERC-20 pair |
| `npm run seats:check-sealed` | Pin a real pack, deploy on a fork, sell out, reveal, read the art back |
| `npm run seats:check-lifecycle` | Activation, rounds, delivery and loans against the live contracts on a fork |
| `npm run seats:check-custom-art` | The bring-your-own-image path end to end |
| `npm run seats:launch-test` | The real thing on mainnet: launch, buy, snipe, activate, distribute, deliver, borrow, repay, sell |

`scripts/recover-test-funds.ts` pulls the ETH back out of a finished test series.

### What a test run actually costs

From the last mainnet run, 0.0253 ETH total:

- **0.0003 gas** for all twenty transactions, including a 7.4M-gas `createSeries`.
- **0.0005** pons launch fee. Gone.
- **0.02** buying fuel. Not a cost — it is held as tokens and can be sold back on the curve.
- **0.0045** in trade and loan fees, which land in the series' own pot and come back through
  distribute → deliver → withdraw.

So a full end-to-end run on mainnet costs under 0.001 ETH once the recoverable parts are recovered.

---

## 11. Things to know before changing this

- **Activation clears on transfer.** That includes the transfer into the loan vault, so a test run
  that borrows leaves the series with nobody on the payroll and `crank` reverting with `no weight`.
- **A round's eligibility is inclusive.** A seat activated in the same second the round opens is not
  in it. This was a real bug, and `testSeatActivatedInTheCrankSecondCannotClaimThatRound` guards it.
- **The reveal depends on the pin label** to find the pack again. The salt and the folder live only
  on the pinning account; losing both means a series can never be revealed.
- **The protocol treasury is an EOA.** It should be a multisig before this carries anyone else's
  money.
- **Contract size.** See §9. Check `forge build --sizes` after touching anything the deployers embed.
- **Metadata hashes are off** (`bytecode_hash = "none"`) to buy back those bytes; verification has to
  use the same setting.
