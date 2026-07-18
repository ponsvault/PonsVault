import { createPublicClient, http } from 'viem';

import { ROBINHOOD_RPC_URL } from './constants';
import { robinhoodChain } from './chain';

export const robinhoodPublicClient = createPublicClient({
  chain: robinhoodChain,
  transport: http(ROBINHOOD_RPC_URL),
});
