import {
  describeFeeShare,
  describeWalletClaimedBy,
  hasFeeShareConfig,
  type FeeShareInfo,
} from '@/lib/fee-share/display';

export function FeeShareBadge({ info, className }: { info: FeeShareInfo; className?: string }) {
  if (!hasFeeShareConfig(info)) return null;

  return (
    <p className={className ?? 'fee-share-badge'}>{describeFeeShare(info)}</p>
  );
}

export function FeeWalletClaimedBadge({
  info,
  className,
}: {
  info: FeeShareInfo;
  className?: string;
}) {
  const label = describeWalletClaimedBy(info);
  if (!label) return null;

  return <p className={className ?? 'fee-wallet-claimed-badge'}>{label}</p>;
}

export function FeeShareBadges({
  info,
  className,
  claimedClassName,
}: {
  info: FeeShareInfo;
  className?: string;
  claimedClassName?: string;
}) {
  if (!hasFeeShareConfig(info) && !describeWalletClaimedBy(info)) return null;

  return (
    <div className={className ?? 'fee-share-badges'}>
      {hasFeeShareConfig(info) ? <FeeShareBadge info={info} /> : null}
      <FeeWalletClaimedBadge info={info} className={claimedClassName} />
    </div>
  );
}
