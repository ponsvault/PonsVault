import { cn } from '@/lib/utils';

export const PONSVAULT_X_URL = 'https://x.com/ponsvault';
export const PONSVAULT_X_HANDLE = '@ponsvault';
export const PONSVAULT_GITHUB_URL = 'https://github.com/ponsvault/PonsVault';

export function XLogo({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      aria-hidden="true"
      className={className}
      fill="currentColor"
    >
      <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
    </svg>
  );
}

export function XSocialLink({
  className,
  iconClassName,
}: {
  className?: string;
  iconClassName?: string;
}) {
  return (
    <a
      href={PONSVAULT_X_URL}
      target="_blank"
      rel="noreferrer"
      className={cn('social-x-link', className)}
      aria-label="PonsVault on X"
    >
      <XLogo className={cn('social-x-icon', iconClassName)} />
    </a>
  );
}
