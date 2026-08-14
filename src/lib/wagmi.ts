import { createConfig, http } from 'wagmi';
import { injected } from 'wagmi/connectors';

import { robinhoodChain } from '@/lib/pons/chain';
import { ROBINHOOD_RPC_URL } from '@/lib/pons/constants';

export const wagmiConfig = createConfig({
  chains: [robinhoodChain],
  connectors: [
    injected({
      // Stores the "disconnected" flag in localStorage so that wallets that were explicitly
      // disconnected do not auto-reconnect, while wallets that are still authorised do. Without
      // this flag, some MetaMask versions return isConnected=false on a fresh page load even though
      // the user never disconnected, causing a persistent "Connect wallet" state until they manually
      // open their wallet.
      shimDisconnect: true,
    }),
  ],
  transports: {
    [robinhoodChain.id]: http(ROBINHOOD_RPC_URL),
  },
  ssr: true,
});
