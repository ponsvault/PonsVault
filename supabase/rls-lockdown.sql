-- ─────────────────────────────────────────────────────────────────────────────
-- PonsVault — Supabase security lockdown (safe to run on existing projects)
-- Run once in Supabase SQL Editor. Does NOT drop the launches table or data.
-- ─────────────────────────────────────────────────────────────────────────────

-- Remove common Supabase starter policies if they were added in the dashboard.
drop policy if exists "Enable read access for all users" on ponsvault_launches;
drop policy if exists "Enable insert for authenticated users only" on ponsvault_launches;
drop policy if exists "Public read" on ponsvault_launches;
drop policy if exists "Public insert" on ponsvault_launches;
drop policy if exists "Public update" on ponsvault_launches;

-- Block direct PostgREST access from browser keys. Server uses service_role only.
revoke all on table ponsvault_launches from anon, authenticated;

alter table ponsvault_launches enable row level security;

-- RESTRICTIVE, not the default PERMISSIVE. Permissive policies are OR'd together,
-- so a `using (false)` permissive policy is a no-op — enabling RLS already denies
-- everything — and it would not stop someone adding "enable read for all users"
-- from the dashboard, since that OR would win. Restrictive policies are AND'd, so
-- this forces false no matter what else is added later.
drop policy if exists "deny_anon_all" on ponsvault_launches;
create policy "deny_anon_all"
  on ponsvault_launches
  as restrictive
  for all
  to anon
  using (false)
  with check (false);

drop policy if exists "deny_authenticated_all" on ponsvault_launches;
create policy "deny_authenticated_all"
  on ponsvault_launches
  as restrictive
  for all
  to authenticated
  using (false)
  with check (false);

-- ── Removed social fee-share tables ──────────────────────────────────────────
-- Safe to run on a database that predates the removal; no-ops otherwise.
drop table if exists fee_claims cascade;
drop table if exists fee_share_wallets cascade;
drop function if exists validate_fee_wallet_privy_link() cascade;

-- ── Optional cleanup (review SELECT first — do NOT run blindly) ───────────────
-- select token, name, symbol, description, vault from ponsvault_launches order by launched_at desc;

-- Delete only obvious PoC rows (uncomment and adjust after reviewing SELECT):
-- delete from ponsvault_launches
-- where lower(symbol) in ('hacked', 'poc')
--    or lower(name) like '%overwritten%'
--    or lower(description) like '%unauthenticated upsert%'
--    or lower(description) like '%overwritten by%';
