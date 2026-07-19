export const PONS_API_BASE = 'https://ponsfamily.com';

export const PONS_CHAIN_ID = 4663;

export const ROBINHOOD_RPC_URL = 'https://rpc.mainnet.chain.robinhood.com';

export const PONS_EXPLORER_URL = 'https://robinhoodchain.blockscout.com';

export {
  PONS_ACTIVE_FACTORY as PONS_FACTORY,
  PONS_ACTIVE_FACTORY_START_BLOCK as PONS_FACTORY_START_BLOCK,
  PONS_ACTIVE_LOCKER as PONS_LOCKER,
  PONS_LEGACY_FACTORY,
  PONS_LEGACY_LOCKER,
  PONS_V3_FACTORY,
  PONS_POSITION_MANAGER,
  PONS_SWAP_ROUTER,
  PONS_QUOTER_V2,
  PONS_WETH,
  PONS_POOL_FEE,
  PONS_REFERENCE_TOKEN,
  TOKEN_LAUNCHED_TOPIC0,
} from './contracts';

import {
  PONS_ACTIVE_FACTORY,
  PONS_ACTIVE_LOCKER,
  PONS_WETH as PONS_WETH_ADDRESS,
} from './contracts';

export const PONS_DEFAULT_CONFIG_ID = 0n;

export const PONS_DEFAULT_DEX_ID = 0n;

/** Graduation threshold in paired WETH (from launchpad status / docs). */
export const PONS_GRADUATION_ETH = 4.2;

/** Fixed total supply: 1e9 tokens × 1e18 wei. */
export const PONS_TOTAL_SUPPLY = '1000000000000000000000000000';

export const PONS_LAUNCH_FEE_ETH = '0.0005';

export const PONS_MAX_TX_BPS = 550;

export const PONS_MAX_WALLET_BPS = 500;

/** Default pool tick when status API is unavailable — used for max dev buy estimate. */
export const PONS_INITIAL_TICK = -204_200;

/** Static fallback when pons API and RPC reads are unavailable. */
export function getDefaultLaunchpadStatus(): import('./types').PonsLaunchpadStatus {
  return {
    chainId: PONS_CHAIN_ID,
    factory: PONS_ACTIVE_FACTORY,
    locker: PONS_ACTIVE_LOCKER,
    launchFeeEth: PONS_LAUNCH_FEE_ETH,
    launchFeeWei: '500000000000000',
    graduationEth: PONS_GRADUATION_ETH,
    launchEnabled: true,
    totalSupply: PONS_TOTAL_SUPPLY,
    weth: PONS_WETH_ADDRESS,
    pairToken: PONS_WETH_ADDRESS,
    maxTxBps: PONS_MAX_TX_BPS,
    maxWalletBps: PONS_MAX_WALLET_BPS,
    initialTick: PONS_INITIAL_TICK,
  };
}

export const TOKEN_NAME_MAX_LENGTH = 32;

export const TOKEN_SYMBOL_MAX_LENGTH = 10;

/** Blocks to scan when indexer API is unavailable. Prefer chunked backfill from PONS_FACTORY_START_BLOCK. */
export const PONS_LAUNCH_LOG_LOOKBACK = 4_000n;
