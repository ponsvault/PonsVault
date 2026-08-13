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
  factory: '0x9d0562025C1646fEcC521C78329f9E58518b702c',
  registry: '0xc04825131d148cd6490253D2290B68d0Dc1ccDF0',
  tbaRegistry: '0x53B7B912bd4914BB8bA66FEA9bEF92E2D4933790',
  protocolTreasury: '0x897ac30f73Ba92E1EFbC1dF1e67f8b5F4b3ECD2b',
  /**
   * Launches the fuel token and creates the series in one transaction, which is one wallet
   * confirmation on any wallet rather than one per call on wallets that cannot batch. The factory
   * trusts this address and no other to name someone else as a series' creator.
   */
  launcher: '0xC7718d362Aa3F3e4252d5b7CC135D234f3768e5D',
  /** Implementation cloned behind every seat's token bound account. */
  accountImplementation: '0xF0Aa798d866F44be07Ef5c49a74c6dFDe1e47f4f',
  /** Split out of the factory to stay under the contract size limit; only the factory calls them. */
  coreDeployer: '0x04Afe22833eeDd3ded37dB06102734b22fb51188',
  marketDeployer: '0xb9138084697AeAe22b0D9801CbD27b8e41eD8dc9',
  /** Where the factory was deployed, bounding any scan for series it has created. */
  startBlock: 35_217_573n,
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
