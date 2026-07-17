import { PrivyClient, type User } from '@privy-io/node';

let client: PrivyClient | null = null;

export function getPrivyServerClient(): PrivyClient {
  const appId = process.env.NEXT_PUBLIC_PRIVY_APP_ID;
  const appSecret = process.env.PRIVY_APP_SECRET;

  if (!appId || !appSecret) {
    throw new Error(
      'Privy is not configured. Set NEXT_PUBLIC_PRIVY_APP_ID and PRIVY_APP_SECRET.',
    );
  }

  if (!client) {
    client = new PrivyClient({ appId, appSecret });
  }

  return client;
}

export function getTwitterUsernameFromPrivyUser(user: User): string | null {
  for (const account of user.linked_accounts) {
    if (account.type === 'twitter_oauth' && account.username) {
      return account.username.toLowerCase();
    }
  }
  return null;
}

export function getGithubUsernameFromPrivyUser(user: User): string | null {
  for (const account of user.linked_accounts) {
    if (account.type === 'github_oauth' && account.username) {
      return account.username.toLowerCase();
    }
  }
  return null;
}
