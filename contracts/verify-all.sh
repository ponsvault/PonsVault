#!/usr/bin/env bash
# Verifies the deployed PonsVault stack on Robinhood Chain's Blockscout.
#
# Addresses mirror src/lib/pons/deployments.ts and section 8 of project_overview.md.
# Blockscout ignores the API key but foundry.toml demands the var be set.
set -uo pipefail

export BLOCKSCOUT_API_KEY="${BLOCKSCOUT_API_KEY:-not-required}"
BS="https://robinhoodchain.blockscout.com/api"
BEACON="lib/openzeppelin-contracts/contracts/proxy/beacon/UpgradeableBeacon.sol:UpgradeableBeacon"

LAUNCHPAD=0xA5aAb3F0c6EeadF30Ef1D3Eb997108E976351feB
LOCKER=0x736D76699C26D0d966744cAe304C000d471f7F35
REGISTRY=0x770c1AA562f7DfA60934959585DaECf2d9AD32be
BUYBACK_IMPL=0x0769730FaDaA0a1C96853f2115De68Ff5d3d2577
STAKING_IMPL=0x7C1459C681F9E96bb66931387a05e3676410b4b3
RWA_IMPL=0x724be4a7eb9d9500d1d95691Faf2713b0ac9Bda0
# The keeper, set as the distributor for every vault this factory creates.
RWA_DISTRIBUTOR=0x897ac30f73Ba92E1EFbC1dF1e67f8b5F4b3ECD2b

# --skip-is-verified-check is not optional here. Blockscout shows a "verified twin" for any
# address whose bytecode matches an already-verified one, so both beacons appear verified off
# the back of whichever was done first, and forge's pre-check believes it and skips. The
# address itself stays unverified. Always confirm with check-verified.sh, which reads
# is_verified rather than trusting forge's message.
#
# Blockscout also rate-limits the ABI fetch that runs *after* a successful submission, which
# looks like a failure but is not. Re-run and it will report already verified.
verify() {
  local label=$1 addr=$2 path=$3
  shift 3
  echo "───────── ${label}  ${addr}"
  if forge verify-contract "$addr" "$path" \
      --chain 4663 --verifier blockscout --verifier-url "$BS" --watch \
      --skip-is-verified-check "$@" 2>&1 | tail -4; then
    echo "OK ${label}"
  else
    echo "FAILED ${label}"
  fi
  sleep 10
}

verify "PonsVaultLauncher" 0x9dDE735093d92EAAD379BE685E62c6d449628f64 \
  src/PonsVaultLauncher.sol:PonsVaultLauncher \
  --constructor-args "$(cast abi-encode 'constructor(address,address,address)' $LAUNCHPAD $LOCKER $REGISTRY)"

verify "BuybackBurnVaultFactory" 0x3926af4490B4BA5Af78d785DD9Ba527B383C1B1e \
  src/factories/PonsBuybackBurnVaultFactory.sol:PonsBuybackBurnVaultFactory

verify "PonsBuybackBurnVault (impl)" $BUYBACK_IMPL \
  src/vaults/PonsBuybackBurnVault.sol:PonsBuybackBurnVault

verify "Buyback beacon" 0x95bEf3Ba39ED9C5aDb265A714ce90c3E102e9B7E "$BEACON" \
  --constructor-args "$(cast abi-encode 'constructor(address)' $BUYBACK_IMPL)"

verify "StakingVaultFactory" 0x1d8B2395E7e5D059544c29f3ee9100fcab0FbbcC \
  src/factories/PonsStakingVaultFactory.sol:PonsStakingVaultFactory

verify "PonsStakingVault (impl)" $STAKING_IMPL \
  src/vaults/PonsStakingVault.sol:PonsStakingVault

verify "Staking beacon" 0xE63445734036E56c81353f77B7DdE2C49Cbfc770 "$BEACON" \
  --constructor-args "$(cast abi-encode 'constructor(address)' $STAKING_IMPL)"

verify "RwaVaultFactory" 0xd015d819751671efCeBBba6A76e1Ad52465104C3 \
  src/factories/PonsRwaVaultFactory.sol:PonsRwaVaultFactory \
  --constructor-args "$(cast abi-encode 'constructor(address)' $RWA_DISTRIBUTOR)"

verify "PonsRwaVault (impl)" $RWA_IMPL \
  src/vaults/PonsRwaVault.sol:PonsRwaVault

verify "Rwa beacon" 0xe6e5BAa743c9600Dbb1bd44c7266AA6D24769560 "$BEACON" \
  --constructor-args "$(cast abi-encode 'constructor(address)' $RWA_IMPL)"

echo "ALL DONE"
