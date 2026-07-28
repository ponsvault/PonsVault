import type { Address, Hex } from 'viem';

import { robinhoodPublicClient } from './client';
import { PONSVAULT_DEPLOYMENT } from './deployments';
import { RpcUnavailableError, isRevert } from './rpc-errors';

const REGISTRY_ABI = [
  {
    type: 'function',
    name: 'factoryFor',
    stateMutability: 'view',
    inputs: [{ name: 'templateId', type: 'bytes32' }],
    outputs: [{ type: 'address' }],
  },
] as const;

const ZERO = '0x0000000000000000000000000000000000000000';

/**
 * The factory that builds a template, or null if the chain cannot build it.
 *
 * Whether a template is launchable is a fact about the registry, not about this
 * codebase: a template's contracts can be written, tested and merged long
 * before anyone registers them, and registering is a transaction someone has to
 * remember to send. Offering a template the registry does not know would let a
 * creator fill in a whole form and pay gas for a revert.
 *
 * `factoryFor` reverts with `UnknownTemplate` rather than returning zero, so a
 * revert here is the expected answer for an unregistered template and not an
 * error worth surfacing.
 *
 * A failure to reach the chain is not that answer, and throws instead. Reading
 * it as "unregistered" would hide a live template from every visitor for as
 * long as the blip lasted, and cache that verdict on the way out.
 *
 * @throws {RpcUnavailableError} If the registry could not be read at all.
 */
export async function factoryForTemplate(templateId: Hex): Promise<Address | null> {
  try {
    const factory = await robinhoodPublicClient.readContract({
      address: PONSVAULT_DEPLOYMENT.registry as Address,
      abi: REGISTRY_ABI,
      functionName: 'factoryFor',
      args: [templateId],
    });
    return factory === ZERO ? null : factory;
  } catch (error) {
    if (isRevert(error)) return null;
    throw new RpcUnavailableError('check which templates are registered', error);
  }
}

export async function isTemplateRegistered(templateId: Hex): Promise<boolean> {
  return (await factoryForTemplate(templateId)) !== null;
}
