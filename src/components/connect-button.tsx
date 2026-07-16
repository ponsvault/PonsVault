'use client';

import { useAccount, useConnect, useDisconnect } from 'wagmi';

import { shortAddress } from '@/lib/utils';

export function ConnectButton() {
  const { address, isConnected } = useAccount();
  const { connect, connectors, isPending, error } = useConnect();
  const { disconnect } = useDisconnect();

  if (isConnected && address) {
    return (
      <button type="button" onClick={() => disconnect()} className="nav-address">
        <span className="nav-address-avatar">
          {address.slice(2, 4).toUpperCase()}
        </span>
        {shortAddress(address, 4)}
      </button>
    );
  }

  const connector = connectors[0];

  return (
    <button
      type="button"
      onClick={() => connector && connect({ connector })}
      disabled={!connector || isPending}
      className="nav-connect"
    >
      {isPending ? 'Connecting…' : error ? 'Retry' : 'Connect'}
    </button>
  );
}
