import { BaseError, ContractFunctionRevertedError, HttpRequestError, TimeoutError } from 'viem';

/**
 * Telling "the contract said no" apart from "we never reached the contract".
 *
 * Both arrive as a rejected promise, and treating them alike is how a throttled
 * RPC ends up being reported to a creator as a fact about the chain — a healthy
 * pool described as empty, a registered template described as missing. A revert
 * is an answer and can be acted on; a transport failure is the absence of one
 * and can only be retried.
 *
 * Worth being careful about here specifically: the public Robinhood RPC sits
 * behind Cloudflare and will challenge a burst of requests, so transport
 * failures are a normal condition rather than a rare one.
 */

/** Raised when the chain could not be reached to answer a question. */
export class RpcUnavailableError extends Error {
  constructor(what: string, cause: unknown) {
    super(`Could not reach the chain to ${what}.`, { cause });
    this.name = 'RpcUnavailableError';
  }
}

/** Whether the node actually executed the call and rejected it. */
export function isRevert(error: unknown): boolean {
  if (error instanceof BaseError) {
    if (error.walk((e) => e instanceof ContractFunctionRevertedError)) return true;
    if (error.walk((e) => e instanceof HttpRequestError || e instanceof TimeoutError)) return false;
  }

  // Nodes that return a bare "execution reverted" with no decodable data still
  // reverted. Anything that does not say so is treated as unreachable, since
  // guessing that the call failed on-chain is the answer that misleads.
  return /execution reverted|reverted/i.test(String(error));
}
