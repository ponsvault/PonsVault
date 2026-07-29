'use client';

import { useConnect } from 'wagmi';
import { useAccount } from 'wagmi';
import { useMemo, useState } from 'react';
import { Check, Loader2 } from 'lucide-react';

import { shortAddress } from '@/lib/utils';

/**
 * A deterministic demo allocation from a wallet address.
 *
 * Not on-chain — this page is a pitch example. The same address always sees
 * the same figure so a founder can reconnect and the story stays consistent.
 */
function demoAllocation(address: string): bigint {
  let h = 0n;
  for (let i = 2; i < Math.min(address.length, 14); i++) {
    h = (h * 31n + BigInt(address.charCodeAt(i))) % 10_000_000n;
  }
  // Between ~1,200 and ~48,000 whole tokens, with six fractional digits.
  return (1_200n + (h % 47_000n)) * 10n ** 18n + (h % 10n ** 6n) * 10n ** 12n;
}

function formatDemo(amount: bigint): string {
  const whole = amount / 10n ** 18n;
  const frac = (amount % 10n ** 18n).toString().padStart(18, '0').slice(0, 4).replace(/0+$/, '');
  const withCommas = whole.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return frac ? `${withCommas}.${frac}` : withCommas;
}

/**
 * Interactive half of the example migration claim page.
 *
 * Claims here are simulated — there is no contract to call — so a founder can
 * walk through the experience without spending gas or needing a real snapshot.
 */
export function MigrationClaimDemo({ symbol = 'MEOW' }: { symbol?: string }) {
  const { address, isConnected } = useAccount();
  const { connect, connectors, isPending: isConnecting } = useConnect();
  const [claimed, setClaimed] = useState(false);
  const [claiming, setClaiming] = useState(false);

  const allocation = useMemo(
    () => (address ? demoAllocation(address) : 0n),
    [address],
  );

  const unclaimed = claimed ? 0n : allocation;
  const claimedTotal = claimed ? allocation : 0n;

  const onClaim = async () => {
    if (!isConnected || claimed || claiming) return;
    setClaiming(true);
    // Pause long enough to feel like a wallet confirm, without sending anything.
    await new Promise((resolve) => setTimeout(resolve, 1200));
    setClaimed(true);
    setClaiming(false);
  };

  const onConnect = () => {
    const connector = connectors[0];
    if (connector) connect({ connector });
  };

  return (
    <section className="mig-claim-panel">
      <div className="mig-claim-panel-bar">
        <span className="mig-claim-panel-label">your allocation</span>
      </div>

      <div className="mig-claim-headline">
        <div className="mig-claim-headline-row">
          <div className="mig-claim-figure">
            {isConnected ? `${formatDemo(unclaimed)} $${symbol}` : '—'}
          </div>
          {isConnected && unclaimed > 0n ? (
            <button
              type="button"
              className="ui-btn ui-btn-primary"
              disabled={claiming}
              onClick={() => void onClaim()}
            >
              {claiming ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              <span className="ui-btn-label">{claiming ? 'Claiming…' : 'Claim'}</span>
            </button>
          ) : null}
          {!isConnected ? (
            <button
              type="button"
              className="ui-btn ui-btn-primary"
              disabled={isConnecting}
              onClick={onConnect}
            >
              <span className="ui-btn-label">{isConnecting ? 'Connecting…' : 'Connect wallet'}</span>
            </button>
          ) : null}
        </div>
        <p className="mig-claim-note">
          {!isConnected
            ? 'Connect the wallet that held the old token at the snapshot.'
            : claimed
              ? `Claimed to ${shortAddress(address!, 4)}. This demo does not send a transaction.`
              : `Ready to claim for ${shortAddress(address!, 4)}.`}
        </p>
      </div>

      {isConnected ? (
        <dl className="mig-claim-totals">
          <div className="mig-claim-total">
            <dt>Unclaimed</dt>
            <dd>{`${formatDemo(unclaimed)} $${symbol}`}</dd>
          </div>
          <div className="mig-claim-total">
            <dt>Claimed</dt>
            <dd>
              {`${formatDemo(claimedTotal)} $${symbol}`}
              {claimed ? <Check className="mig-claim-check" size={14} strokeWidth={2.5} /> : null}
            </dd>
          </div>
        </dl>
      ) : null}

      <p className="mig-claim-foot">
        On a live migration this button sends one transaction to a verified claim
        contract. Your allocation is fixed from the holder snapshot — nobody else
        can take it.
      </p>
    </section>
  );
}
