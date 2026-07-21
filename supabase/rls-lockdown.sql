-- ─────────────────────────────────────────────────────────────────────────────
-- PonsShare — Supabase security lockdown (safe to run on existing projects)
-- Run once in Supabase SQL Editor. Does NOT drop tables or data.
-- ─────────────────────────────────────────────────────────────────────────────

-- Remove common Supabase starter policies if they were added in the dashboard.
drop policy if exists "Enable read access for all users" on fee_share_wallets;
drop policy if exists "Enable insert for authenticated users only" on fee_share_wallets;
drop policy if exists "Enable update for users based on email" on fee_share_wallets;
drop policy if exists "Public read" on fee_share_wallets;
drop policy if exists "Public insert" on fee_share_wallets;
drop policy if exists "Public update" on fee_share_wallets;

drop policy if exists "Enable read access for all users" on ponsshare_launches;
drop policy if exists "Enable insert for authenticated users only" on ponsshare_launches;
drop policy if exists "Public read" on ponsshare_launches;
drop policy if exists "Public insert" on ponsshare_launches;
drop policy if exists "Public update" on ponsshare_launches;

drop policy if exists "Enable read access for all users" on fee_claims;
drop policy if exists "Enable insert for authenticated users only" on fee_claims;
drop policy if exists "Public read" on fee_claims;
drop policy if exists "Public insert" on fee_claims;
drop policy if exists "Public update" on fee_claims;

-- Block direct PostgREST access from browser keys. Server uses service_role only.
revoke all on table fee_share_wallets from anon, authenticated;
revoke all on table ponsshare_launches from anon, authenticated;
revoke all on table fee_claims from anon, authenticated;

alter table fee_share_wallets enable row level security;
alter table ponsshare_launches enable row level security;
alter table fee_claims enable row level security;

drop policy if exists "deny_anon_all" on fee_share_wallets;
create policy "deny_anon_all"
  on fee_share_wallets
  for all
  to anon
  using (false)
  with check (false);

drop policy if exists "deny_authenticated_all" on fee_share_wallets;
create policy "deny_authenticated_all"
  on fee_share_wallets
  for all
  to authenticated
  using (false)
  with check (false);

drop policy if exists "deny_anon_all" on ponsshare_launches;
create policy "deny_anon_all"
  on ponsshare_launches
  for all
  to anon
  using (false)
  with check (false);

drop policy if exists "deny_authenticated_all" on ponsshare_launches;
create policy "deny_authenticated_all"
  on ponsshare_launches
  for all
  to authenticated
  using (false)
  with check (false);

drop policy if exists "deny_anon_all" on fee_claims;
create policy "deny_anon_all"
  on fee_claims
  for all
  to anon
  using (false)
  with check (false);

drop policy if exists "deny_authenticated_all" on fee_claims;
create policy "deny_authenticated_all"
  on fee_claims
  for all
  to authenticated
  using (false)
  with check (false);

-- linked_at can only be set together with a real Privy link (blocks manual SQL larp).
create or replace function validate_fee_wallet_privy_link()
returns trigger
language plpgsql
as $$
begin
  if new.linked_at is not null then
    if new.privy_user_id is null or new.privy_wallet_id is null then
      raise exception 'linked_at requires privy_user_id and privy_wallet_id';
    end if;

    if new.privy_user_id !~ '^did:privy:' then
      raise exception 'invalid privy_user_id';
    end if;

    if length(new.privy_wallet_id) < 8 then
      raise exception 'invalid privy_wallet_id';
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists fee_share_wallets_validate_privy_link on fee_share_wallets;
create trigger fee_share_wallets_validate_privy_link
  before insert or update on fee_share_wallets
  for each row
  execute function validate_fee_wallet_privy_link();

-- ── Cleanup fake rows from PoC / manual SQL (review SELECT first) ─────────────
-- select token, name, symbol, fee_share_handle from ponsshare_launches order by launched_at desc;
-- select platform, handle, linked_at, privy_user_id from fee_share_wallets order by created_at desc;

-- Strip fake "wallet claimed" badges (linked_at without real Privy IDs):
update fee_share_wallets
set linked_at = null,
    privy_user_id = null,
    privy_wallet_id = null
where linked_at is not null
  and (
    privy_user_id is null
    or privy_user_id !~ '^did:privy:'
    or privy_wallet_id is null
  );

-- Delete obvious malicious launch overwrites (adjust symbols/names as needed):
delete from ponsshare_launches
where lower(symbol) in ('hacked', 'poc')
   or lower(name) like '%overwritten%'
   or lower(description) like '%unauthenticated upsert%'
   or lower(description) like '%overwritten by%';
