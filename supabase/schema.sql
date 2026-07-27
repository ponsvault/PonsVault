-- ─────────────────────────────────────────────────────────────────────────────
-- PonsVault — Supabase schema
-- Run in Supabase SQL Editor (Database → SQL Editor → New query)
-- ─────────────────────────────────────────────────────────────────────────────

-- ── Reset (dev only — drops all app tables) ─────────────────────────────────
-- fee_claims and fee_share_wallets belonged to the removed social fee-share
-- feature. The drops stay so running this on an older database cleans them up.
drop table if exists fee_claims cascade;
drop table if exists fee_share_wallets cascade;
drop table if exists ponsvault_launches cascade;

create extension if not exists "pgcrypto";

-- ── ponsvault_launches ────────────────────────────────────────────────────────
-- Every token launched through PonsVault. This is a convenience index over
-- on-chain data, not a source of truth: each row is verified against the chain
-- before it is written, and the chain wins in any disagreement.
create table if not exists ponsvault_launches (
  id                 uuid        primary key default gen_random_uuid(),
  token              text        not null unique,
  name               text        not null,
  symbol             text        not null,
  description        text        not null default '',
  logo               text        not null default '',
  deployer           text        not null,
  -- Address the locker pays creator fees to. Equals the vault for vault launches.
  fee_wallet         text        not null,
  -- Vault attached at launch, if any. Both are null when the creator launched
  -- without one, in which case fees accrue to their own wallet.
  vault              text,
  vault_template     text
                               check (
                                 vault_template is null
                                 or vault_template in ('buyback-burn', 'staking', 'lottery', 'rwa-tax')
                               ),
  transaction_hash   text        not null,
  launched_at        timestamptz not null,
  created_at         timestamptz not null default now()
);

-- ── Indexes ───────────────────────────────────────────────────────────────────
create index if not exists idx_ponsvault_launches_launched_at
  on ponsvault_launches (launched_at desc);

create index if not exists idx_ponsvault_launches_fee_wallet
  on ponsvault_launches (lower(fee_wallet));

create index if not exists idx_ponsvault_launches_deployer
  on ponsvault_launches (lower(deployer));

create index if not exists idx_ponsvault_launches_vault
  on ponsvault_launches (lower(vault))
  where vault is not null;

-- ── Row-level security ────────────────────────────────────────────────────────
-- App access is server-only via SUPABASE_SERVICE_ROLE_KEY (bypasses RLS).
-- anon/authenticated must not read or write this table directly.
alter table ponsvault_launches enable row level security;

revoke all on table ponsvault_launches from anon, authenticated;

create policy "deny_anon_all"
  on ponsvault_launches for all to anon using (false) with check (false);
create policy "deny_authenticated_all"
  on ponsvault_launches for all to authenticated using (false) with check (false);
