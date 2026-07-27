-- ─────────────────────────────────────────────────────────────────────────────
-- PonsVault — keeper_ticks
-- Run in Supabase SQL Editor. Safe to run on a live database: it creates one
-- table and touches nothing else. (schema.sql drops ponsvault_launches, so use
-- this file rather than that one when you already have launches recorded.)
-- ─────────────────────────────────────────────────────────────────────────────

create extension if not exists "pgcrypto";

-- One row per keeper pass, whether or not it ran anything.
--
-- Exists so "is the scheduler alive?" is answerable. A tick that decides to run
-- nothing looks identical, from the outside, to a cron that stopped firing three
-- days ago — and the difference only shows up as vaults quietly not burning.
-- Recording every pass makes silence measurable.
create table if not exists keeper_ticks (
  id          uuid        primary key default gen_random_uuid(),
  ran_at      timestamptz not null default now(),
  -- Vaults considered, and how many were actually sent a transaction.
  checked     integer     not null,
  ran         integer     not null,
  -- Whose gas paid for it, and what was left afterwards. Wei as text, because
  -- wei overflows a JS number and this is only ever displayed.
  keeper      text        not null,
  balance_wei text        not null,
  -- Full per-vault detail: status, amounts, and the reason anything was skipped.
  outcomes    jsonb       not null default '[]'::jsonb,
  duration_ms integer,
  -- Set when the pass itself failed rather than an individual vault.
  error       text
);

-- The only access pattern: the most recent ticks, newest first.
create index if not exists idx_keeper_ticks_ran_at
  on keeper_ticks (ran_at desc);

-- ── Row-level security ────────────────────────────────────────────────────────
-- Same posture as ponsvault_launches: server-only via SUPABASE_SERVICE_ROLE_KEY,
-- which bypasses RLS. anon/authenticated must not touch this directly.
alter table keeper_ticks enable row level security;

revoke all on table keeper_ticks from anon, authenticated;

-- RESTRICTIVE, not the default PERMISSIVE. Permissive policies are OR'd together,
-- so a `using (false)` permissive policy is a no-op — enabling RLS already denies
-- everything — and it would not stop someone adding "enable read for all users"
-- from the dashboard, since that OR would win. Restrictive policies are AND'd, so
-- this forces false no matter what else is added later.
create policy "deny_anon_all"
  on keeper_ticks as restrictive for all to anon using (false) with check (false);
create policy "deny_authenticated_all"
  on keeper_ticks as restrictive for all to authenticated using (false) with check (false);
