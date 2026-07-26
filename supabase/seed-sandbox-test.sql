-- ─────────────────────────────────────────────────────────────────────────────
-- Test data: the Sandbox (SBX) launch used to exercise the vault on chain 4663.
--
-- Only needed so /explore lists the token. The token page reads vault state
-- straight from the chain and does not use this row.
--
-- Addresses are lowercased to match how the app writes them (see launchToRow
-- in src/lib/launch-registry/store.ts) — lookups compare against lower(...).
-- ─────────────────────────────────────────────────────────────────────────────

insert into ponsvault_launches (
  token,
  name,
  symbol,
  description,
  logo,
  deployer,
  fee_wallet,
  vault,
  vault_template,
  transaction_hash,
  launched_at
) values (
  '0xa84b9f3b386a4875e524a0c35a4569ce85a1d083',
  'Sandbox',
  'SBX',
  'Test launch. No value, no team, no promises.',
  '',
  '0xcd0875124415a61d0d9082496ae8e88c2d55a642',
  -- The locker pays the vault directly, so fee_wallet is the vault.
  '0x97bc2f82e978c373e9a3a25cae751e7e9cfabd15',
  '0x97bc2f82e978c373e9a3a25cae751e7e9cfabd15',
  'buyback-burn',
  '0x6ea6f57ecdf346c31216cda551e81e96fbcecfaa1da170d97bf35ab379b79a45',
  '2026-07-25T18:39:19+00:00'
)
on conflict (token) do update set
  name             = excluded.name,
  symbol           = excluded.symbol,
  description      = excluded.description,
  logo             = excluded.logo,
  deployer         = excluded.deployer,
  fee_wallet       = excluded.fee_wallet,
  vault            = excluded.vault,
  vault_template   = excluded.vault_template,
  transaction_hash = excluded.transaction_hash,
  launched_at      = excluded.launched_at;
