import { defineChain } from 'viem';

import { PONS_CHAIN_ID, ROBINHOOD_RPC_URL } from './constants';

export const robinhoodChain = defineChain({
  id: PONS_CHAIN_ID,
  name: 'Robinhood Chain',
  nativeCurrency: {
    name: 'Ether',
    symbol: 'ETH',
    decimals: 18,
  },
  rpcUrls: {
    default: {
      http: [ROBINHOOD_RPC_URL],
    },
  },
  blockExplorers: {
    default: {
      name: 'Robinhood Explorer',
      url: 'https://robinhoodchain.blockscout.com',
    },
  },
  contracts: {
    // Deployed at the canonical address, but viem will not batch reads unless a
    // chain says so, and this chain is not in its registry. Without this every
    // `multicall` throws and callers fall back to one request per read, which a
    // holder snapshot turns into hundreds.
    //
    // No `blockCreated`: it is only consulted for historical multicalls, and
    // this RPC prunes old state anyway, so reads are against recent blocks.
    multicall3: { address: '0xcA11bde05977b3631167028862bE2a173976CA11' },
  },
});
