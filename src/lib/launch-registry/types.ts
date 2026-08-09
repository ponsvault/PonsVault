import type { VaultTemplateId } from '@/lib/pons/vault';

export interface PonsVaultLaunchRecord {
  token: string;
  name: string;
  symbol: string;
  description: string;
  logo: string;
  deployer: string;
  feeWallet: string;
  /** Vault contract attached at launch, absent when launched without one. */
  vault?: string;
  vaultTemplate?: VaultTemplateId;
  transactionHash: string;
  launchedAt: string;
  /** App-side sticky flag — pons factory graduation is not sticky on-chain. */
  everGraduated?: boolean;
}

export interface PonsVaultLaunchRegistryFile {
  launches: PonsVaultLaunchRecord[];
}
