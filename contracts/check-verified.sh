#!/usr/bin/env bash
# Confirms the deployed stack is verified, straight from Blockscout rather than from
# forge's "already verified" message. Paced because the public API rate-limits hard.
set -uo pipefail

check() {
  local label=$1 addr=$2
  local body
  body=$(curl -s "https://robinhoodchain.blockscout.com/api/v2/smart-contracts/${addr}")
  printf '%-28s %s  ' "$label" "$addr"
  echo "$body" | python3 -c '
import sys, json
try:
    d = json.load(sys.stdin)
except Exception:
    print("could not read response (rate limited?)"); raise SystemExit
print("verified" if d.get("is_verified") else "NOT VERIFIED",
      "|", d.get("name"),
      "| optimizer runs:", d.get("optimization_runs"))
'
  sleep 12
}

check "PonsVaultRegistry"        0x770c1AA562f7DfA60934959585DaECf2d9AD32be
check "PonsVaultLauncher"        0x9dDE735093d92EAAD379BE685E62c6d449628f64
check "BuybackBurnVaultFactory"  0x3926af4490B4BA5Af78d785DD9Ba527B383C1B1e
check "Buyback beacon"           0x95bEf3Ba39ED9C5aDb265A714ce90c3E102e9B7E
check "Buyback vault impl"       0x0769730FaDaA0a1C96853f2115De68Ff5d3d2577
check "StakingVaultFactory"      0x1d8B2395E7e5D059544c29f3ee9100fcab0FbbcC
check "Staking beacon"           0xE63445734036E56c81353f77B7DdE2C49Cbfc770
check "Staking vault impl"       0x7C1459C681F9E96bb66931387a05e3676410b4b3
