/**
 * The parts of `PonsRwaVault` anything off-chain needs.
 *
 * Deliberately not the whole artifact: the keeper, the proofs API and the claim
 * panel each touch a handful of functions, and a trimmed ABI keeps what they
 * rely on visible.
 */
export const PONS_RWA_VAULT_ABI = [
  {
    type: 'function',
    name: 'run',
    stateMutability: 'nonpayable',
    inputs: [{ name: 'minRwaOut', type: 'uint256' }],
    outputs: [
      { name: 'roundId', type: 'uint256' },
      { name: 'amount', type: 'uint256' },
    ],
  },
  {
    type: 'function',
    name: 'postRoot',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'roundId', type: 'uint256' },
      { name: 'root', type: 'bytes32' },
    ],
    outputs: [],
  },
  {
    type: 'function',
    name: 'claim',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'roundId', type: 'uint256' },
      { name: 'account', type: 'address' },
      { name: 'amount', type: 'uint256' },
      { name: 'proof', type: 'bytes32[]' },
    ],
    outputs: [],
  },
  {
    type: 'function',
    name: 'rounds',
    stateMutability: 'view',
    inputs: [{ name: 'roundId', type: 'uint256' }],
    outputs: [
      {
        type: 'tuple',
        components: [
          { name: 'root', type: 'bytes32' },
          { name: 'total', type: 'uint128' },
          { name: 'claimed', type: 'uint128' },
          { name: 'snapshotBlock', type: 'uint64' },
          { name: 'openedAt', type: 'uint64' },
          { name: 'reclaimed', type: 'bool' },
        ],
      },
    ],
  },
  {
    type: 'function',
    name: 'roundCount',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ type: 'uint256' }],
  },
  {
    type: 'function',
    name: 'roundsAwaitingRoot',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ type: 'uint256[]' }],
  },
  {
    type: 'function',
    name: 'hasClaimed',
    stateMutability: 'view',
    inputs: [
      { name: 'roundId', type: 'uint256' },
      { name: 'account', type: 'address' },
    ],
    outputs: [{ type: 'bool' }],
  },
  {
    type: 'function',
    name: 'distributor',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ type: 'address' }],
  },
  {
    type: 'function',
    name: 'token',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ type: 'address' }],
  },
  {
    type: 'function',
    name: 'config',
    stateMutability: 'view',
    inputs: [],
    outputs: [
      { name: 'rwaAsset', type: 'address' },
      { name: 'rwaPoolFee', type: 'uint24' },
      { name: 'minHarvestWei', type: 'uint256' },
    ],
  },
  {
    type: 'function',
    name: 'undistributedRwa',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ type: 'uint256' }],
  },
  {
    type: 'function',
    name: 'template',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ type: 'string' }],
  },
  {
    type: 'function',
    name: 'canRun',
    stateMutability: 'view',
    inputs: [],
    outputs: [
      { name: 'ready', type: 'bool' },
      { name: 'reason', type: 'string' },
    ],
  },
  {
    type: 'function',
    name: 'runCount',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ type: 'uint256' }],
  },
  {
    type: 'function',
    name: 'lastRunAt',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ type: 'uint256' }],
  },
  {
    type: 'function',
    name: 'totalWethConverted',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ type: 'uint256' }],
  },
  {
    type: 'function',
    name: 'totalRwaDistributed',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ type: 'uint256' }],
  },
  {
    type: 'event',
    name: 'RoundOpened',
    inputs: [
      { name: 'roundId', type: 'uint256', indexed: true },
      { name: 'amount', type: 'uint256', indexed: false },
      { name: 'snapshotBlock', type: 'uint256', indexed: false },
    ],
  },
] as const;
