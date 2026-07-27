-- The live check still only allowed an older template set. Schema.sql already
-- lists staking + rwa-tax, but the deployed database never got that update, so
-- every staking launch failed to record and disappeared from Explore.
--
-- Run this once in the Supabase SQL editor, then refresh /explore.

alter table public.ponsvault_launches
  drop constraint if exists ponsvault_launches_vault_template_check;

alter table public.ponsvault_launches
  add constraint ponsvault_launches_vault_template_check
  check (
    vault_template is null
    or vault_template in ('buyback-burn', 'staking', 'lottery', 'rwa-tax')
  );

-- Backfill the three staking launches that already exist on-chain under the
-- current launcher. Safe to re-run: upserts on token.

insert into public.ponsvault_launches (
  token, name, symbol, description, logo,
  deployer, fee_wallet, vault, vault_template,
  transaction_hash, launched_at
) values
(
  '0xdc37d39f4e0f4eb9cac26ec07252c02101e9150f',
  'Vault',
  'VAULT',
  '',
  '',
  '0x9dDE735093d92EAAD379BE685E62c6d449628f64',
  '0x75310724d63bc9e0eb63e6edb46b4e1ee4929839',
  '0xd1dd3c67e92bd2a8b7e0d613bb65c01140b789bd',
  'staking',
  '0xc301c373917be86c2c40060a52e28bfa124583dbf94e19339d92fb3925d86475',
  '2026-07-27T21:18:30Z'
),
(
  '0xa91bdb83b58ba9d38fe3139d0c81f21c9f408778',
  'STAKE THIS SHIT',
  'SHIT',
  '',
  '',
  '0x9dDE735093d92EAAD379BE685E62c6d449628f64',
  '0x75310724d63bc9e0eb63e6edb46b4e1ee4929839',
  '0x5e2c0a7c392de7d9b844160eeacb2e4f57189ad2',
  'staking',
  '0xf8960d07747acd3e21a0e3f294ab0ae9091c49ac33f6021f6991a68910525530',
  '2026-07-27T21:20:44Z'
),
(
  '0xa2fa02245a790d75afad8a0518ddcc3c1a7fd413',
  'TEST',
  'TEST',
  '',
  '',
  '0x9dDE735093d92EAAD379BE685E62c6d449628f64',
  '0x89485a9ddb000369dd5118c116cead9005486c9c',
  '0xb27430791ac11999f1904a3c62dd5db1246746d2',
  'staking',
  '0x756419141be83066e8ad9b485d414c2d156a62f0640def8941618af976d97d48',
  '2026-07-27T23:39:20Z'
)
on conflict (token) do update set
  name = excluded.name,
  symbol = excluded.symbol,
  vault = excluded.vault,
  vault_template = excluded.vault_template,
  fee_wallet = excluded.fee_wallet,
  transaction_hash = excluded.transaction_hash,
  launched_at = excluded.launched_at;
