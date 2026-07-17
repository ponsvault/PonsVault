-- ─────────────────────────────────────────────────────────────────────────────
-- PonsShare — Supabase schema
-- Run in Supabase SQL Editor (Database → SQL Editor → New query)
-- ─────────────────────────────────────────────────────────────────────────────

-- ── Reset (dev only — drops all app tables) ─────────────────────────────────
drop table if exists fee_claims cascade;
drop table if exists ponsshare_launches cascade;
drop table if exists fee_share_wallets cascade;

create extension if not exists "pgcrypto";

-- ── fee_share_wallets ─────────────────────────────────────────────────────────
-- Platform-generated EVM wallets for social fee recipients.
-- Wallets are created at launch time, then linked to a Privy user on first claim login.
-- private_key is stored in plain text for now (server-side only via service role).
create table if not exists fee_share_wallets (
  id                     uuid        primary key default gen_random_uuid(),
  platform               text        not null
                                     check (platform in ('twitter', 'github', 'tiktok', 'twitch')),
  handle                 text        not null,
  custom_user_id         text        not null unique,
  wallet_address         text        not null unique,
  private_key            text        not null,
  privy_user_id          text,
  privy_wallet_id        text,
  linked_at              timestamptz,
  created_at             timestamptz not null default now(),
  unique (platform, handle)
);

-- ── ponsshare_launches ────────────────────────────────────────────────────────
create table if not exists ponsshare_launches (
  id                 uuid        primary key default gen_random_uuid(),
  token              text        not null unique,
  name               text        not null,
  symbol             text        not null,
  description        text        not null default '',
  logo               text        not null default '',
  deployer           text        not null,
  fee_wallet         text        not null,
  fee_share_platform text
                               check (
                                 fee_share_platform is null
                                 or fee_share_platform in ('twitter', 'github', 'tiktok', 'twitch')
                               ),
  fee_share_handle   text,
  transaction_hash   text        not null,
  launched_at        timestamptz not null,
  created_at         timestamptz not null default now()
);

-- ── fee_claims ────────────────────────────────────────────────────────────────
-- Records when a fee recipient claims creator fees for a token.
create table if not exists fee_claims (
  id                     uuid        primary key default gen_random_uuid(),
  token                  text        not null references ponsshare_launches (token) on delete cascade,
  fee_wallet_id          uuid        not null references fee_share_wallets (id) on delete cascade,
  wallet_address         text        not null,
  privy_user_id          text        not null,
  claim_transaction_hash text,
  claimed_at             timestamptz not null default now(),
  unique (token, fee_wallet_id)
);

-- ── Indexes ───────────────────────────────────────────────────────────────────
create index if not exists idx_fee_share_wallets_lookup
  on fee_share_wallets (platform, handle);

create index if not exists idx_fee_share_wallets_wallet
  on fee_share_wallets (lower(wallet_address));

create index if not exists idx_fee_share_wallets_privy_user
  on fee_share_wallets (privy_user_id)
  where privy_user_id is not null;

create index if not exists idx_ponsshare_launches_launched_at
  on ponsshare_launches (launched_at desc);

create index if not exists idx_ponsshare_launches_fee_share
  on ponsshare_launches (fee_share_platform, fee_share_handle);

create index if not exists idx_ponsshare_launches_fee_wallet
  on ponsshare_launches (lower(fee_wallet));

create index if not exists idx_ponsshare_launches_deployer
  on ponsshare_launches (lower(deployer));

create index if not exists idx_fee_claims_wallet
  on fee_claims (fee_wallet_id, claimed_at desc);

create index if not exists idx_fee_claims_token
  on fee_claims (token);

-- ── Row-level security ────────────────────────────────────────────────────────
alter table fee_share_wallets enable row level security;
alter table ponsshare_launches enable row level security;
alter table fee_claims enable row level security;
