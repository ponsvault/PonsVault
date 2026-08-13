export const PONS_SEAT_SERIES_REGISTRY_ABI = [
  {
    type: 'function',
    name: 'seriesCount',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ type: 'uint256' }],
  },
  {
    type: 'function',
    name: 'series',
    stateMutability: 'view',
    inputs: [{ name: 'seriesId', type: 'uint256' }],
    outputs: [
      { name: 'creator', type: 'address' },
      { name: 'token', type: 'address' },
      { name: 'collection', type: 'address' },
      { name: 'amm', type: 'address' },
      { name: 'activation', type: 'address' },
      { name: 'booster', type: 'address' },
      { name: 'loan', type: 'address' },
      { name: 'name', type: 'string' },
      { name: 'symbol', type: 'string' },
      { name: 'maxSupply', type: 'uint256' },
      { name: 'createdAt', type: 'uint64' },
    ],
  },
] as const;

const CREATE_PARAMS_COMPONENTS = [
  { name: 'name', type: 'string' },
  { name: 'symbol', type: 'string' },
  { name: 'tokenName', type: 'string' },
  { name: 'tokenSymbol', type: 'string' },
  { name: 'baseTokenURI', type: 'string' },
  { name: 'provenanceHash', type: 'bytes32' },
  { name: 'maxSupply', type: 'uint256' },
  { name: 'tokenSupply', type: 'uint256' },
  { name: 'seatPrice', type: 'uint256' },
  { name: 'swapFeeBps', type: 'uint16' },
  { name: 'snipeFeeBps', type: 'uint16' },
  { name: 'royaltyBps', type: 'uint16' },
  { name: 'distributeThreshold', type: 'uint256' },
  { name: 'protocolTreasury', type: 'address' },
  { name: 'activationFees', type: 'uint256[]' },
  { name: 'activationWeights', type: 'uint256[]' },
  { name: 'loanTermSeconds', type: 'uint64' },
  { name: 'loanMinEthFee', type: 'uint256' },
  { name: 'fuelToken', type: 'address' },
  { name: 'loanSeed', type: 'uint256' },
] as const;

/**
 * Launches the fuel token and the series that runs on it in one transaction.
 *
 * `creatorFeeRecipient`, `expectedEconomics` and the salt are all overwritten on-chain, and so are
 * the series' `fuelToken` and `loanSeed` — the launcher fills them with the token it just created.
 */
export const PONS_SEAT_LAUNCHER_ABI = [
  {
    type: 'function',
    name: 'launchSeries',
    stateMutability: 'payable',
    inputs: [
      {
        name: 'params',
        type: 'tuple',
        components: [
          { name: 'name', type: 'string' },
          { name: 'symbol', type: 'string' },
          { name: 'logo', type: 'string' },
          { name: 'description', type: 'string' },
          {
            name: 'socials',
            type: 'tuple',
            components: [
              { name: 'twitter', type: 'string' },
              { name: 'telegram', type: 'string' },
              { name: 'discord', type: 'string' },
              { name: 'website', type: 'string' },
              { name: 'farcaster', type: 'string' },
            ],
          },
          { name: 'creatorFeeRecipient', type: 'address' },
          { name: 'creatorTaxBps', type: 'uint16' },
          { name: 'buybackEnabled', type: 'bool' },
          { name: 'expectedEconomics', type: 'bytes32' },
          { name: 'salt', type: 'bytes32' },
        ],
      },
      { name: 'launchConfigId', type: 'uint256' },
      { name: 'pairToken', type: 'address' },
      { name: 'firstBuy', type: 'uint256' },
      { name: 'minFuelOut', type: 'uint256' },
      { name: 'series', type: 'tuple', components: CREATE_PARAMS_COMPONENTS },
    ],
    outputs: [
      { name: 'seriesId', type: 'uint256' },
      { name: 'fuelToken', type: 'address' },
      { name: 'curve', type: 'address' },
    ],
  },
  {
    type: 'event',
    name: 'SeriesLaunched',
    inputs: [
      { name: 'seriesId', type: 'uint256', indexed: true },
      { name: 'creator', type: 'address', indexed: true },
      { name: 'fuelToken', type: 'address', indexed: true },
      { name: 'curve', type: 'address', indexed: false },
      { name: 'firstBuy', type: 'uint256', indexed: false },
    ],
  },
] as const;

export const PONS_SEAT_SERIES_FACTORY_ABI = [
  {
    type: 'function',
    name: 'createSeries',
    stateMutability: 'nonpayable',
    inputs: [
      {
        name: 'p',
        type: 'tuple',
        components: [
          { name: 'name', type: 'string' },
          { name: 'symbol', type: 'string' },
          { name: 'tokenName', type: 'string' },
          { name: 'tokenSymbol', type: 'string' },
          { name: 'baseTokenURI', type: 'string' },
          { name: 'provenanceHash', type: 'bytes32' },
          { name: 'maxSupply', type: 'uint256' },
          { name: 'tokenSupply', type: 'uint256' },
          { name: 'seatPrice', type: 'uint256' },
          { name: 'swapFeeBps', type: 'uint16' },
          { name: 'snipeFeeBps', type: 'uint16' },
          { name: 'royaltyBps', type: 'uint16' },
          { name: 'distributeThreshold', type: 'uint256' },
          { name: 'protocolTreasury', type: 'address' },
          { name: 'activationFees', type: 'uint256[]' },
          { name: 'activationWeights', type: 'uint256[]' },
          { name: 'loanTermSeconds', type: 'uint64' },
          { name: 'loanMinEthFee', type: 'uint256' },
          // An ERC-20 the series should use as its fuel, or the zero address to mint a companion
          // token. A token that already trades — a Pons V2 curve launch — gives buyers somewhere to
          // get fuel; a minted one starts entirely in the creator's wallet.
          { name: 'fuelToken', type: 'address' },
          // Fuel pulled from the creator to stock the loan vault. Only used with fuelToken set, and
          // zero is fine: the vault lends from its balance and can be topped up later.
          { name: 'loanSeed', type: 'uint256' },
        ],
      },
    ],
    outputs: [{ type: 'uint256' }],
  },
  {
    type: 'event',
    name: 'SeriesCreated',
    inputs: [
      { name: 'seriesId', type: 'uint256', indexed: true },
      { name: 'creator', type: 'address', indexed: true },
      { name: 'token', type: 'address', indexed: false },
      { name: 'collection', type: 'address', indexed: false },
      { name: 'amm', type: 'address', indexed: false },
      { name: 'activation', type: 'address', indexed: false },
      { name: 'booster', type: 'address', indexed: false },
      { name: 'loan', type: 'address', indexed: false },
    ],
  },
] as const;

export const PONS_SEAT_AMM_ABI = [
  {
    type: 'function',
    name: 'buy',
    stateMutability: 'payable',
    inputs: [],
    outputs: [{ type: 'uint256' }],
  },
  {
    type: 'function',
    name: 'snipe',
    stateMutability: 'payable',
    inputs: [{ name: 'tokenId', type: 'uint256' }],
    outputs: [],
  },
  {
    type: 'function',
    name: 'sell',
    stateMutability: 'payable',
    inputs: [{ name: 'tokenId', type: 'uint256' }],
    outputs: [],
  },
  {
    type: 'function',
    name: 'seatPrice',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ type: 'uint256' }],
  },
  {
    type: 'function',
    name: 'inventorySize',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ type: 'uint256' }],
  },
  {
    // Resold stock plus every seat not yet minted, which is what a buyer can actually buy.
    type: 'function',
    name: 'availableSupply',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ type: 'uint256' }],
  },
] as const;

export const PONS_SEAT_ACTIVATION_ABI = [
  {
    // Sum of every activated seat's tier weight, and the denominator a reward round divides by.
    type: 'function',
    name: 'totalWeight',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ type: 'uint256' }],
  },
  {
    type: 'function',
    name: 'weightOf',
    stateMutability: 'view',
    inputs: [{ name: 'tokenId', type: 'uint256' }],
    outputs: [{ type: 'uint256' }],
  },
  {
    // When the seat joined the payroll. A round only pays seats that were on it before the round
    // opened, and upgrading restamps this.
    type: 'function',
    name: 'activatedAt',
    stateMutability: 'view',
    inputs: [{ name: 'tokenId', type: 'uint256' }],
    outputs: [{ type: 'uint64' }],
  },
  {
    type: 'function',
    name: 'activate',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'tokenId', type: 'uint256' },
      { name: 'tier', type: 'uint8' },
    ],
    outputs: [],
  },
  {
    type: 'function',
    name: 'upgrade',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'tokenId', type: 'uint256' },
      { name: 'tier', type: 'uint8' },
    ],
    outputs: [],
  },
  {
    type: 'function',
    name: 'isActivated',
    stateMutability: 'view',
    inputs: [{ name: 'tokenId', type: 'uint256' }],
    outputs: [{ type: 'bool' }],
  },
  {
    type: 'function',
    name: 'tiers',
    stateMutability: 'view',
    inputs: [{ type: 'uint256' }],
    outputs: [
      { name: 'fee', type: 'uint256' },
      { name: 'weight', type: 'uint256' },
    ],
  },
] as const;

export const PONS_SEAT_BOOSTER_ABI = [
  {
    type: 'function',
    name: 'rounds',
    stateMutability: 'view',
    inputs: [{ name: 'roundId', type: 'uint256' }],
    outputs: [
      { name: 'pot', type: 'uint256' },
      { name: 'totalWeight', type: 'uint256' },
      { name: 'distributed', type: 'uint256' },
      { name: 'startedAt', type: 'uint64' },
    ],
  },
  {
    type: 'function',
    name: 'electionOf',
    stateMutability: 'view',
    inputs: [{ name: 'tokenId', type: 'uint256' }],
    outputs: [
      { name: 'tokens', type: 'address[]' },
      { name: 'weights', type: 'uint256[]' },
    ],
  },
  {
    type: 'function',
    name: 'crank',
    stateMutability: 'nonpayable',
    inputs: [],
    outputs: [{ type: 'uint256' }],
  },
  {
    type: 'function',
    name: 'deliver',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'roundId', type: 'uint256' },
      { name: 'tokenId', type: 'uint256' },
    ],
    outputs: [],
  },
  {
    type: 'function',
    name: 'elect',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'tokenId', type: 'uint256' },
      { name: 'tokens', type: 'address[]' },
      { name: 'weights', type: 'uint256[]' },
    ],
    outputs: [],
  },
  {
    type: 'function',
    name: 'accruedEth',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ type: 'uint256' }],
  },
  {
    type: 'function',
    name: 'threshold',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ type: 'uint256' }],
  },
  {
    type: 'function',
    name: 'roundCount',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ type: 'uint256' }],
  },
] as const;

export const PONS_SEAT_LOAN_ABI = [
  {
    // ETH a borrow has to carry, fixed when the series was created.
    type: 'function',
    name: 'minEthFee',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ type: 'uint256' }],
  },
  {
    type: 'function',
    name: 'borrow',
    stateMutability: 'payable',
    inputs: [{ name: 'tokenId', type: 'uint256' }],
    outputs: [],
  },
  {
    type: 'function',
    name: 'repay',
    stateMutability: 'nonpayable',
    inputs: [{ name: 'tokenId', type: 'uint256' }],
    outputs: [],
  },
  {
    type: 'function',
    name: 'liquidate',
    stateMutability: 'nonpayable',
    inputs: [{ name: 'tokenId', type: 'uint256' }],
    outputs: [],
  },
  {
    type: 'function',
    name: 'principalAmount',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ type: 'uint256' }],
  },
  {
    type: 'function',
    name: 'loans',
    stateMutability: 'view',
    inputs: [{ name: 'tokenId', type: 'uint256' }],
    outputs: [
      { name: 'borrower', type: 'address' },
      { name: 'principal', type: 'uint256' },
      { name: 'start', type: 'uint64' },
      { name: 'due', type: 'uint64' },
    ],
  },
] as const;

export const ERC20_ABI = [
  {
    type: 'function',
    name: 'approve',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'spender', type: 'address' },
      { name: 'amount', type: 'uint256' },
    ],
    outputs: [{ type: 'bool' }],
  },
  {
    type: 'function',
    name: 'allowance',
    stateMutability: 'view',
    inputs: [
      { name: 'owner', type: 'address' },
      { name: 'spender', type: 'address' },
    ],
    outputs: [{ type: 'uint256' }],
  },
  {
    type: 'function',
    name: 'balanceOf',
    stateMutability: 'view',
    inputs: [{ name: 'account', type: 'address' }],
    outputs: [{ type: 'uint256' }],
  },
] as const;

export const ERC721_ABI = [
  {
    type: 'function',
    name: 'tokenURI',
    stateMutability: 'view',
    inputs: [{ name: 'tokenId', type: 'uint256' }],
    outputs: [{ type: 'string' }],
  },
  {
    type: 'function',
    name: 'approve',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'to', type: 'address' },
      { name: 'tokenId', type: 'uint256' },
    ],
    outputs: [],
  },
  {
    type: 'function',
    name: 'setApprovalForAll',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'operator', type: 'address' },
      { name: 'approved', type: 'bool' },
    ],
    outputs: [],
  },
  {
    type: 'function',
    name: 'ownerOf',
    stateMutability: 'view',
    inputs: [{ name: 'tokenId', type: 'uint256' }],
    outputs: [{ type: 'address' }],
  },
  {
    type: 'function',
    name: 'balanceOf',
    stateMutability: 'view',
    inputs: [{ name: 'owner', type: 'address' }],
    outputs: [{ type: 'uint256' }],
  },
] as const;

/** The seat collection, beyond plain ERC-721: what is minted and what is still for sale. */
export const PONS_SEAT_COLLECTION_ABI = [
  ...ERC721_ABI,
  {
    type: 'function',
    name: 'isMinted',
    stateMutability: 'view',
    inputs: [{ name: 'tokenId', type: 'uint256' }],
    outputs: [{ type: 'bool' }],
  },
  {
    type: 'function',
    name: 'totalMinted',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ type: 'uint256' }],
  },
  {
    type: 'function',
    name: 'maxSupply',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ type: 'uint256' }],
  },
  {
    type: 'function',
    name: 'revealed',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ type: 'bool' }],
  },
  {
    /** True once the sale is over, by sellout or by window, and the pack can be swapped in. */
    type: 'function',
    name: 'revealable',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ type: 'bool' }],
  },
  {
    type: 'function',
    name: 'revealAfter',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ type: 'uint64' }],
  },
  {
    type: 'function',
    name: 'provenanceHash',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ type: 'bytes32' }],
  },
  {
    /** Anyone may call this: only the pack committed at creation passes the check. */
    type: 'function',
    name: 'reveal',
    stateMutability: 'nonpayable',
    inputs: [{ name: 'baseTokenURI', type: 'string' }],
    outputs: [],
  },
  {
    // Reverts on a seat nobody has minted yet, so only ask once isMinted says otherwise.
    type: 'function',
    name: 'tokenURI',
    stateMutability: 'view',
    inputs: [{ name: 'tokenId', type: 'uint256' }],
    outputs: [{ type: 'string' }],
  },
  {
    // The seat's wallet address, which is fixed from the moment the seat exists and can hold funds
    // long before the wallet itself is deployed.
    type: 'function',
    name: 'accountOf',
    stateMutability: 'view',
    inputs: [{ name: 'tokenId', type: 'uint256' }],
    outputs: [{ type: 'address' }],
  },
  {
    // Deploys that wallet, which has to happen once before it can send anything out.
    type: 'function',
    name: 'createAccount',
    stateMutability: 'nonpayable',
    inputs: [{ name: 'tokenId', type: 'uint256' }],
    outputs: [{ type: 'address' }],
  },
] as const;

/** A seat's own wallet. Only whoever holds the seat NFT can make it act. */
export const PONS_SEAT_ACCOUNT_ABI = [
  {
    type: 'function',
    name: 'owner',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ type: 'address' }],
  },
  {
    type: 'function',
    name: 'execute',
    stateMutability: 'payable',
    inputs: [
      { name: 'to', type: 'address' },
      { name: 'value', type: 'uint256' },
      { name: 'data', type: 'bytes' },
    ],
    outputs: [{ type: 'bytes' }],
  },
] as const;
