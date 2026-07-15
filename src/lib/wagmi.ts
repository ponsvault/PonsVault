import { createConfig, http } from 'wagmi';
import { injected } from 'wagmi/connectors';

import { robinhoodChain } from '@/lib/pons/chain';
import { ROBINHOOD_RPC_URL } from '@/lib/pons/constants';

export const wagmiConfig = createConfig({
  chains: [robinhoodChain],
  connectors: [injected()],
  transports: {
    [robinhoodChain.id]: http(ROBINHOOD_RPC_URL),
  },
  ssr: true,
});
