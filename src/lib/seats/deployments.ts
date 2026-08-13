import type { Address } from 'viem';

/**
 * The deployed Seat infrastructure on Robinhood Chain, from `forge script DeployPonsSeats`.
 *
 * Replace these as a set, never one at a time. The registry only lets its current factory repoint
 * it, so a new factory has to be deployed alongside a new registry.
 *
 * Constants rather than environment variables, for the same reason as PONSVAULT_DEPLOYMENT: the
 * factory is the on-chain deployer of every series it creates and the registry is where those
 * series are recorded, so neither can move without stranding them. Splitting the pair across a
 * `.env` invites publishing this deploy's factory next to the last deploy's registry, with nothing
 * to catch it.
 *
 * It also stops the desk from silently disappearing. As env vars these were simply never set, so a
 * fully deployed, fully wired Seats stack sat unreachable behind a UI that reported it unavailable.
 *
 * `protocolTreasury` is the deploy wallet, which is what DeployPonsSeats prints as the treasury.
 * It receives the protocol half of every activation fee, and unlike the rest is a policy choice
 * rather than a deployed address — point it at a multisig when there is one.
 *
 * Leave an address empty and the Seats UI offers creation as unavailable rather than building a
 * transaction that would revert.
 */
export const PONS_SEAT_DEPLOYMENT = {
  factory: '0xBF397C95ABa08d174F0FB60bAa3D0F2101265a9c',
  registry: '0x278FFA5A46283A05635A3d33d820D9Cc7D7E67E2',
  tbaRegistry: '0xBcEFd591F0475Ea575bdd20Ea68f177638D2e33c',
  protocolTreasury: '0x897ac30f73Ba92E1EFbC1dF1e67f8b5F4b3ECD2b',
  /**
   * Launches the fuel token and creates the series in one transaction, which is one wallet
   * confirmation on any wallet rather than one per call on wallets that cannot batch. The factory
   * trusts this address and no other to name someone else as a series' creator.
   */
  launcher: '0x09D31B19DDd35Bf5864BbFD79a811AFc1caccB89',
  /** Implementation cloned behind every seat's token bound account. */
  accountImplementation: '0xAa73f9fb620F61B3773687F0fbf4F8957b75B99f',
  /** Split out of the factory to stay under the contract size limit; only the factory calls them. */
  coreDeployer: '0x684538b603b4c58ccd4e68C072A64212aA143f32',
  marketDeployer: '0x4503C83d537e90321F076FE98AD6E777d03d7D2b',
  /** Where the factory was deployed, bounding any scan for series it has created. */
  startBlock: 35_229_185n,
} as const satisfies Record<string, Address | '' | bigint>;

/**
 * Whether an address is the seat launcher.
 *
 * pons records whoever calls `launchToken` as a token's deployer, and only its own configured
 * forwarder may name someone else, so a one-transaction launch is deployed by this contract. The
 * field carries no rights — fees are escrowed to the creator fee recipient and every creator action
 * is gated on that — but a UI showing this address as the person behind a token would be wrong.
 */
export function isSeatLauncher(address: string | undefined | null): boolean {
  if (!address) return false;
  return address.toLowerCase() === PONS_SEAT_DEPLOYMENT.launcher.toLowerCase();
}

export function isSeatInfraConfigured(): boolean {
  return (
    PONS_SEAT_DEPLOYMENT.factory.length === 42 &&
    PONS_SEAT_DEPLOYMENT.registry.length === 42 &&
    PONS_SEAT_DEPLOYMENT.protocolTreasury.length === 42
  );
}
