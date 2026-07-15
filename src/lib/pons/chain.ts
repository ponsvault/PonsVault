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
});
