/**
 * The deployed PonsVault stack. One deploy, one edit, one diff.
 *
 * These are constants rather than environment variables on purpose. The launcher
 * is the on-chain deployer of every token it creates, so it can never move
 * without stranding them — an address that cannot change is described more
 * honestly by code than by config. Keeping the other three alongside it means a
 * redeploy cannot half-land, which is exactly what splitting them across a `.env`
 * and a source file invited: publish this deploy's factories next to the last
 * deploy's launcher, with nothing to catch it.
 *
 * `startBlock` is where the launcher was deployed, which bounds the keeper's scan
 * for vaults it has created.
 *
 * Leave an address empty and the docs page renders "publishing after deploy"
 * instead of a broken explorer link, and the launch form offers vault templates
 * as unavailable rather than building a transaction that would revert.
 */
export const PONSVAULT_DEPLOYMENT = {
  launcher: '0x9dDE735093d92EAAD379BE685E62c6d449628f64',
  registry: '0x770c1AA562f7DfA60934959585DaECf2d9AD32be',
  buybackFactory: '0x3926af4490B4BA5Af78d785DD9Ba527B383C1B1e',
  stakingFactory: '0x1d8B2395E7e5D059544c29f3ee9100fcab0FbbcC',
  rwaFactory: '0xd015d819751671efCeBBba6A76e1Ad52465104C3',
  startBlock: 20_991_727n,
} as const;

const ADDRESSES = PONSVAULT_DEPLOYMENT;

export interface PonsVaultContract {
  name: string;
  role: string;
  address: string;
}

export const PONSVAULT_CONTRACTS: PonsVaultContract[] = [
  {
    name: 'PonsVaultLauncher',
    role: 'Performs the launch, so it becomes the token\u2019s on-chain deployer. Wires fees to the vault and exposes the open sweep that lets anyone trigger a run.',
    address: ADDRESSES.launcher,
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
  {
    name: 'PonsRwaVaultFactory',
    role: 'Deploys one RWA Dividend vault per token. Also fixes the address allowed to post each round\u2019s allocation, so a creator cannot appoint themselves.',
    address: ADDRESSES.rwaFactory,
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
