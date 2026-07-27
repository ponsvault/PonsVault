import { PONSVAULT_LAUNCHER } from './vault';

/**
 * The PonsVault contracts, as published on the docs page.
 *
 * Addresses are filled in once, here, after the deploy script runs. Only the
 * launcher is read from the environment, because the app actually transacts
 * with it — the rest are published for verification rather than used at
 * runtime, so a constant is honest about what they are for.
 *
 * An empty address renders as "publishing after deploy" rather than a broken
 * explorer link, which is what makes it safe to ship this page before the
 * stack is live.
 */
const ADDRESSES = {
  registry: '0x770c1AA562f7DfA60934959585DaECf2d9AD32be',
  buybackFactory: '0x3926af4490B4BA5Af78d785DD9Ba527B383C1B1e',
  stakingFactory: '0x1d8B2395E7e5D059544c29f3ee9100fcab0FbbcC',
} as const;

export interface PonsVaultContract {
  name: string;
  role: string;
  address: string;
}

export const PONSVAULT_CONTRACTS: PonsVaultContract[] = [
  {
    name: 'PonsVaultLauncher',
    role: 'Performs the launch, so it becomes the token\u2019s on-chain deployer. Wires fees to the vault and exposes the open sweep that lets anyone trigger a run.',
    address: PONSVAULT_LAUNCHER,
  },
  {
    name: 'PonsVaultRegistry',
    role: 'Maps a template id to the factory that builds it. Lets a new template ship without moving the launcher.',
    address: ADDRESSES.registry,
  },
  {
    name: 'PonsBuybackBurnVaultFactory',
    role: 'Deploys one Buyback & Burn vault per token, behind a shared beacon.',
    address: ADDRESSES.buybackFactory,
  },
  {
    name: 'PonsStakingVaultFactory',
    role: 'Deploys one Staking vault per token, behind its own shared beacon.',
    address: ADDRESSES.stakingFactory,
  },
];

/** pons and chain contracts PonsVault builds on, none of which we control. */
export const UPSTREAM_CONTRACTS: PonsVaultContract[] = [
  {
    name: 'pons factory',
    role: 'Deploys every token. PonsVault calls it rather than replacing it.',
    address: '0xA5aAb3F0c6EeadF30Ef1D3Eb997108E976351feB',
  },
  {
    name: 'pons locker',
    role: 'Holds each launch\u2019s liquidity position and pays the creator\u2019s share of trading fees to whichever address is set to receive them \u2014 your vault, once one is attached.',
    address: '0x736D76699C26D0d966744cAe304C000d471f7F35',
  },
  {
    name: 'WETH',
    role: 'The asset fees arrive in.',
    address: '0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73',
  },
];
