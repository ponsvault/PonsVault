/**
 * PonsVault v2 stack — deployed 2026-08-06 against the current pons v2 factory.
 *
 * Upstream addresses match https://docs.ponsfamily.com/v2.
 * The earlier factory `0x7E1EAbd5…` was replaced — do not use it.
 */
export const PONSVAULT_V2_DEPLOYMENT = {
  launcher: '0xD948EDCDB832529bB3458B0463F5E02Bb448888e',
  registry: '0xaA9C86049A258D4A076d3eF367F69C231C9746D5',
  buybackFactory: '0xdE4670A2Be85Baa3f6a2C1F6443101EA041362aB',
  stakingFactory: '0x1488473464F2C6E6c5C412f05d805c619322E7EB',
  /** First block of the DeployPonsV2Vault broadcast. */
  startBlock: 29599074n,
} as const;

/** Current pons v2 contracts on Robinhood Chain mainnet. */
export const PONS_V2 = {
  factory: '0x7eD598BcEf8bd9Edd8C97A195C6d13f40801EC7e',
  feeEscrow: '0xd3AFEB2a57f70eF218Aa82451c51B2fb0416Ac9e',
  buybackVault: '0x42df2a798f82289E177311362e8f5ccC45c1219c',
  memeHook: '0xE5e702641Ea86F4ae6cC3cDaeD2B886f976Be044',
  locker: '0x267444D099b10fB5Ed7c3Cc7B7c767AdcA574952',
  launchDeployer: '0x3711ceA4feaDE896C913C68F01Eda97Cb06D1A42',
  launchAndBuy: '0xe33E9E479dF8802cb0866d5d05258bEc4cF62948',
  poolManager: '0x8366a39CC670B4001A1121B8F6A443A643e40951',
} as const;

/**
 * Quote assets the create flow may offer.
 *
 * Only tokens that pass `approvedPairTokens` + non-zero economics on the live
 * factory belong here. Native ETH / WETH are intentionally absent — both are
 * still closed on-chain.
 */
export const PONS_V2_PAIR_TOKENS = [
  {
    symbol: 'AAPL',
    name: 'Apple • Robinhood Token',
    address: '0xaF3D76f1834A1d425780943C99Ea8A608f8a93f9',
    decimals: 18,
  },
  {
    symbol: 'NVDA',
    name: 'NVIDIA • Robinhood Token',
    address: '0xd0601ce157db5bdc3162bbac2a2c8af5320d9eec',
    decimals: 18,
  },
  {
    symbol: 'TSLA',
    name: 'Tesla • Robinhood Token',
    address: '0x322f0929c4625ed5bad873c95208d54e1c003b2d',
    decimals: 18,
  },
  {
    symbol: 'GOOGL',
    name: 'Alphabet Class A • Robinhood Token',
    address: '0x2e0847e8910a9732eb3fb1bb4b70a580adad4fe3',
    decimals: 18,
  },
  {
    symbol: 'GME',
    name: 'GameStop • Robinhood Token',
    address: '0x1b0e319c6a659f002271b69db8a7df2f911c153e',
    decimals: 18,
  },
  {
    symbol: 'SPY',
    name: 'SPDR S&P 500 ETF Trust • Robinhood Token',
    address: '0x117cc2133c37b721f49de2a7a74833232b3b4c0c',
    decimals: 18,
  },
  {
    symbol: 'SPCX',
    name: 'SpaceX Class A • Robinhood Token',
    address: '0x4a0e65a3eccec6dbe60ae065f2e7bb85fae35eea',
    decimals: 18,
  },
  {
    symbol: 'USDG',
    name: 'Global Dollar',
    address: '0x5fc5360d0400a0fd4f2af552add042d716f1d168',
    decimals: 6,
  },
] as const;

export type V2PairToken = (typeof PONS_V2_PAIR_TOKENS)[number];

export function findV2PairToken(address: string): V2PairToken | undefined {
  const needle = address.trim().toLowerCase();
  return PONS_V2_PAIR_TOKENS.find((entry) => entry.address.toLowerCase() === needle);
}

export function isV2VaultLauncherDeployed(): boolean {
  return PONSVAULT_V2_DEPLOYMENT.launcher.trim().length === 42;
}

/** Docs-facing inventory of the live v2 stack. */
export const PONSVAULT_V2_CONTRACTS = [
  {
    name: 'PonsV2VaultLauncher',
    role: 'Launches a pons v2 token and attaches a vault, then points creator fees at that vault.',
    address: PONSVAULT_V2_DEPLOYMENT.launcher,
  },
  {
    name: 'PonsV2VaultRegistry',
    role: 'Maps a template id to the factory that builds it.',
    address: PONSVAULT_V2_DEPLOYMENT.registry,
  },
  {
    name: 'PonsV2BuybackBurnVaultFactory',
    role: 'Deploys one Buyback & Burn vault per token.',
    address: PONSVAULT_V2_DEPLOYMENT.buybackFactory,
  },
  {
    name: 'PonsV2StakingVaultFactory',
    role: 'Deploys one Staking vault per token.',
    address: PONSVAULT_V2_DEPLOYMENT.stakingFactory,
  },
] as const;

export const PONS_V2_UPSTREAM_CONTRACTS = [
  {
    name: 'pons v2 factory',
    role: 'Open launch factory. PonsVault calls it rather than replacing it.',
    address: PONS_V2.factory,
  },
  {
    name: 'pons fee escrow',
    role: 'Holds claimable creator balances in the launch quote asset.',
    address: PONS_V2.feeEscrow,
  },
  {
    name: 'Uniswap v4 PoolManager',
    role: 'Where graduated launches trade after the bonding curve.',
    address: PONS_V2.poolManager,
  },
] as const;
