/**
 * The parts of `PonsLotteryVault` the site and keeper need.
 */
export const PONS_LOTTERY_VAULT_ABI = [
  {
    type: 'function',
    name: 'run',
    stateMutability: 'nonpayable',
    inputs: [],
    outputs: [
      { name: 'roundId', type: 'uint256' },
      { name: 'prizeWeth', type: 'uint256' },
    ],
  },
  {
    type: 'function',
    name: 'enter',
    stateMutability: 'nonpayable',
    inputs: [],
    outputs: [],
  },
  {
    type: 'function',
    name: 'commit',
    stateMutability: 'nonpayable',
    inputs: [{ name: 'commitment', type: 'bytes32' }],
    outputs: [],
  },
  {
    type: 'function',
    name: 'reveal',
    stateMutability: 'nonpayable',
    inputs: [{ name: 'secret', type: 'uint256' }],
    outputs: [],
  },
  {
    type: 'function',
    name: 'config',
    stateMutability: 'view',
    inputs: [],
    outputs: [
      { name: 'minHarvestWei', type: 'uint256' },
      { name: 'entryPeriod', type: 'uint32' },
      { name: 'revealDelay', type: 'uint32' },
    ],
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
    name: 'rounds',
    stateMutability: 'view',
    inputs: [{ name: 'roundId', type: 'uint256' }],
    outputs: [
      {
        type: 'tuple',
        components: [
          { name: 'prizeWeth', type: 'uint128' },
          { name: 'entryEndsAt', type: 'uint64' },
          { name: 'revealAfter', type: 'uint64' },
          { name: 'commitment', type: 'bytes32' },
          { name: 'winner', type: 'address' },
          { name: 'phase', type: 'uint8' },
        ],
      },
    ],
  },
  { type: 'function', name: 'roundCount', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint256' }] },
  {
    type: 'function',
    name: 'entrantCount',
    stateMutability: 'view',
    inputs: [{ name: 'roundId', type: 'uint256' }],
    outputs: [{ type: 'uint256' }],
  },
  {
    type: 'function',
    name: 'hasEntered',
    stateMutability: 'view',
    inputs: [
      { name: 'roundId', type: 'uint256' },
      { name: 'account', type: 'address' },
    ],
    outputs: [{ type: 'bool' }],
  },
  { type: 'function', name: 'totalPrizePaid', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint256' }] },
  { type: 'function', name: 'operator', stateMutability: 'view', inputs: [], outputs: [{ type: 'address' }] },
  { type: 'function', name: 'runCount', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint256' }] },
  { type: 'function', name: 'lastRunAt', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint256' }] },
  { type: 'function', name: 'template', stateMutability: 'pure', inputs: [], outputs: [{ type: 'string' }] },
  { type: 'function', name: 'idleBalances', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint256' }, { type: 'uint256' }] },

  { type: 'error', name: 'NothingToHarvest', inputs: [] },
  { type: 'error', name: 'RoundActive', inputs: [{ name: 'roundId', type: 'uint256' }] },
  { type: 'error', name: 'NoActiveRound', inputs: [] },
  { type: 'error', name: 'EntryClosed', inputs: [] },
  { type: 'error', name: 'AlreadyEntered', inputs: [{ name: 'account', type: 'address' }] },
  { type: 'error', name: 'NotAHolder', inputs: [] },
  { type: 'error', name: 'WrongPhase', inputs: [] },
  { type: 'error', name: 'BadReveal', inputs: [] },
  { type: 'error', name: 'NoEntrants', inputs: [] },
] as const;

/** Matches `PonsLotteryVault.Phase`. */
export const LOTTERY_PHASE = {
  None: 0,
  Entering: 1,
  Committed: 2,
  Drawn: 3,
  Cancelled: 4,
} as const;
