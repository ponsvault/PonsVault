import type { Address } from 'viem';

/**
 * Flagship $VAULT — the PonsVault buyback token shown on the landing hero.
 *
 * v1 launch (WETH pair). Address is fixed; stats are always read live.
 */
export const SHOWCASE_VAULT_TOKEN = {
  token: '0xfdae23ce76018da62507bb5ef20e6ef5450e8312' as Address,
  vault: '0x4a95863226826701031c282b611493affbfa096e' as Address,
  symbol: 'VAULT',
  name: 'PonsVault',
  /** v1 launches pair against WETH. */
  pairSymbol: 'WETH',
} as const;
