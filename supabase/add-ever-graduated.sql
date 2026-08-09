-- Sticky graduation: pons factory `graduationStatus.graduated` tracks *current*
-- paired WETH, so sells can flip a graduated token back to "climbing". We keep
-- an app-side flag once a launch has ever crossed the threshold.
--
-- Run once in the Supabase SQL editor, then refresh /explore.

alter table public.ponsvault_launches
  add column if not exists ever_graduated boolean not null default false;

-- Known graduated launches that later sold below 4.2 ETH.
update public.ponsvault_launches
set ever_graduated = true
where token in (
  '0xfdae23ce76018da62507bb5ef20e6ef5450e8312', -- PonsVault $VAULT
  '0xa84b9f3b386a4875e524a0c35a4569ce85a1d083'  -- Sandbox $SBX
);

-- Verify:
--   select symbol, ever_graduated from public.ponsvault_launches
--   where ever_graduated order by launched_at desc;
