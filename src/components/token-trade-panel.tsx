'use client';

import { useMutation, useQuery } from '@tanstack/react-query';
import { Loader2 } from 'lucide-react';
import { useMemo, useState } from 'react';
import { useAccount, usePublicClient, useSwitchChain, useWalletClient } from 'wagmi';
import { parseEther, type Address } from 'viem';

import { fetchSwapQuote } from '@/lib/pons/api';
import { PONS_CHAIN_ID } from '@/lib/pons/constants';
import { PONS_SWAP_ROUTER } from '@/lib/pons/contracts';
import {
  applySlippage,
  encodeExactInputSingle,
  readTokenAllowance,
} from '@/lib/pons/swap';
import { txUrl } from '@/lib/pons/launch';
import type { TokenDetailResponse } from '@/lib/pons/types';
import { cn, formatCompactNumber } from '@/lib/utils';

interface TokenTradePanelProps {
  token: Address;
  symbol: string;
  detail: TokenDetailResponse;
}

type TradeSide = 'buy' | 'sell';

export function TokenTradePanel({ token, symbol, detail }: TokenTradePanelProps) {
  const [side, setSide] = useState<TradeSide>('buy');
  const [amount, setAmount] = useState('0.01');
  const [txHash, setTxHash] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const { address, chainId, isConnected } = useAccount();
  const { switchChainAsync } = useSwitchChain();
  const { data: walletClient } = useWalletClient();
  const publicClient = usePublicClient();

  const quoteQuery = useQuery({
    queryKey: ['swap-quote', token, side, amount],
    queryFn: () => fetchSwapQuote({ token, side, amount }),
    enabled: Number(amount) > 0,
    refetchInterval: 12_000,
  });

  const outputLabel = useMemo(() => {
    if (!quoteQuery.data) return '—';
    return side === 'buy'
      ? `${formatCompactNumber(Number(quoteQuery.data.amountOutFormatted))} ${symbol}`
      : `${formatCompactNumber(Number(quoteQuery.data.amountOutFormatted))} ETH`;
  }, [quoteQuery.data, side, symbol]);

  const swapMutation = useMutation({
    mutationFn: async () => {
      if (!walletClient || !address || !publicClient) throw new Error('Connect your wallet first.');
      if (chainId !== PONS_CHAIN_ID) {
        await switchChainAsync({ chainId: PONS_CHAIN_ID });
      }
      if (!quoteQuery.data) throw new Error('Quote not ready yet.');

      const amountIn = BigInt(quoteQuery.data.amountIn);
      const amountOutMinimum = applySlippage(BigInt(quoteQuery.data.amountOut));

      if (side === 'sell') {
        const allowance = await readTokenAllowance(address, token);
        if (allowance < amountIn) {
          const approveHash = await walletClient.writeContract({
            account: address,
            chain: walletClient.chain,
            address: token,
            abi: [
              {
                type: 'function',
                name: 'approve',
                stateMutability: 'nonpayable',
                inputs: [
                  { name: 'spender', type: 'address' },
                  { name: 'amount', type: 'uint256' },
                ],
                outputs: [{ type: 'bool' }],
              },
            ],
            functionName: 'approve',
            args: [PONS_SWAP_ROUTER, amountIn],
          });
          await publicClient.waitForTransactionReceipt({ hash: approveHash });
        }
      }

      try {
        parseEther(amount);
      } catch {
        throw new Error('Invalid amount.');
      }

      const tx = encodeExactInputSingle({
        token,
        side,
        amountIn,
        amountOutMinimum,
        recipient: address,
      });

      const hash = await walletClient.sendTransaction({
        account: address,
        chain: walletClient.chain,
        to: tx.to,
        data: tx.data,
        value: tx.value,
      });

      await publicClient.waitForTransactionReceipt({ hash });
      return hash;
    },
    onSuccess: (hash) => {
      setTxHash(hash);
      setError(null);
    },
    onError: (err) => {
      setError(err instanceof Error ? err.message : 'Swap failed.');
    },
  });

  return (
    <section className="token-trade-panel">
      <div className="token-trade-tabs">
        <button
          type="button"
          className={cn('token-trade-tab', side === 'buy' && 'is-active')}
          onClick={() => setSide('buy')}
        >
          Buy
        </button>
        <button
          type="button"
          className={cn('token-trade-tab', side === 'sell' && 'is-active')}
          onClick={() => setSide('sell')}
        >
          Sell
        </button>
      </div>

      <label className="token-trade-field">
        <span>{side === 'buy' ? 'You pay' : 'You sell'}</span>
        <div className="token-trade-input-row">
          <input
            type="text"
            inputMode="decimal"
            value={amount}
            onChange={(event) => setAmount(event.target.value)}
            className="token-trade-input"
          />
          <span className="token-trade-unit">{side === 'buy' ? 'ETH' : symbol}</span>
        </div>
      </label>

      <div className="token-trade-output">
        <span>You receive</span>
        <strong>{quoteQuery.isFetching ? 'Quoting…' : outputLabel}</strong>
      </div>

      <p className="token-trade-note">
        Swaps route through the pons Uniswap V3 pool at 1% fee. Slippage tolerance is 1%.
      </p>

      {!isConnected ? (
        <p className="token-trade-hint">Connect your wallet in the header to trade.</p>
      ) : (
        <button
          type="button"
          className="home-btn home-btn-primary token-trade-submit"
          disabled={swapMutation.isPending || quoteQuery.isLoading || !quoteQuery.data}
          onClick={() => swapMutation.mutate()}
        >
          {swapMutation.isPending ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin" />
              Confirming…
            </>
          ) : side === 'buy' ? (
            `Buy ${symbol}`
          ) : (
            `Sell ${symbol}`
          )}
        </button>
      )}

      {error ? <p className="launchpad-field-note is-error">{error}</p> : null}
      {txHash ? (
        <p className="token-trade-success">
          Swap submitted.{' '}
          <a href={txUrl(txHash as `0x${string}`)} target="_blank" rel="noreferrer">
            View tx
          </a>
        </p>
      ) : null}

      <dl className="token-trade-meta">
        <div>
          <dt>Pool</dt>
          <dd>{detail.metadata.pool.slice(0, 10)}…</dd>
        </div>
        <div>
          <dt>Graduation</dt>
          <dd>{detail.graduation.graduated ? 'Graduated' : `${Math.round(detail.graduation.progress * 100)}%`}</dd>
        </div>
      </dl>
    </section>
  );
}
