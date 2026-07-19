import { describeFeeShare, hasFeeShareConfig, type FeeShareInfo } from '@/lib/fee-share/display';

export function FeeShareBadge({ info, className }: { info: FeeShareInfo; className?: string }) {
  if (!hasFeeShareConfig(info)) return null;

  return (
    <p className={className ?? 'fee-share-badge'}>{describeFeeShare(info)}</p>
  );
}
