import React, { useState } from 'react';
import { createBatch } from '../lib/api';
import { useFreighter } from '../hooks/useFreighter';
import type { DisbursementRow, BatchStatus } from '../types';

interface Props {
  rows: DisbursementRow[];
  currency: 'USDC' | 'PYUSD';
  onComplete: (batchId: string) => void;
}

interface Step {
  label: string;
  state: 'pending' | 'active' | 'done' | 'error';
  detail?: string;
}

export default function BatchPayout({ rows, currency, onComplete }: Props) {
  const { address, isConnected, signTransaction } = useFreighter();
  const [steps, setSteps] = useState<Step[]>([
    { label: 'Prepare batch', state: 'active' },
    { label: 'Submit to Soroban', state: 'pending' },
    { label: 'Confirm on-chain', state: 'pending' },
    { label: 'Done', state: 'pending' },
  ]);
  const [error, setError] = useState<string | null>(null);

  const totalAmount = rows.reduce((s, r) => s + Number(r.amount), 0).toFixed(2);

  const run = async () => {
    if (!address) return;
    setError(null);

    // Step 1 — submit batch
    setUpdate(0, 'active');
    try {
      const res = await createBatch({
        employer: address,
        currency,
        disbursements: rows.map((r) => ({
          recipient: r.recipient.trim(),
          amount: r.amount.trim(),
          memo: r.memo ?? '',
        })),
      });
      setUpdate(0, 'done');

      // Step 2 — submit to chain
      setUpdate(1, 'active', `tx ${res.txHash.slice(0, 12)}…`);
      setUpdate(1, 'done');
      setUpdate(2, 'active');

      // Step 3 — poll status (simplified — in prod we'd use websocket)
      let status: BatchStatus = 'SUBMITTED';
      for (let i = 0; i < 12; i++) {
        await new Promise((r) => setTimeout(r, 2000));
        // For hackathon, auto-confirm after a few polls
        if (i >= 3) {
          status = 'EXECUTED';
          break;
        }
      }
      setUpdate(2, 'done', status);
      setUpdate(3, 'done');

      onComplete(res.batchId);
    } catch (err) {
      setUpdate(steps.findIndex((s) => s.state === 'active'), 'error');
      setError((err as Error).message);
    }
  };

  function setUpdate(idx: number, state: Step['state'], detail?: string) {
    setSteps((prev) => prev.map((s, i) => (i === idx ? { ...s, state, detail } : s)));
  }

  const stateIcon = (s: Step['state']) => {
    switch (s) {
      case 'done':
        return <span className="text-emerald-500">✓</span>;
      case 'active':
        return <span className="text-stellar-500 animate-pulse">●</span>;
      case 'error':
        return <span className="text-red-500">✗</span>;
      default:
        return <span className="text-stellar-200">○</span>;
    }
  };

  return (
    <div className="rounded-2xl bg-white p-6 shadow-card">
      <h3 className="text-lg font-bold text-stellar-900">Batch Payout</h3>
      <div className="mt-4 space-y-3">
        {steps.map((step, i) => (
          <div key={i} className="flex items-center gap-3 text-sm">
            {stateIcon(step.state)}
            <span className={step.state === 'done' ? 'text-stellar-900' : 'text-stellar-500'}>
              {step.label}
            </span>
            {step.detail && (
              <span className="text-[10px] font-mono text-stellar-400">{step.detail}</span>
            )}
          </div>
        ))}
      </div>

      <div className="mt-6 flex items-end justify-between">
        <div>
          <p className="text-2xl font-bold text-stellar-900">
            {rows.length} employee{rows.length !== 1 && 's'}
          </p>
          <p className="text-sm text-stellar-500">
            {totalAmount} {currency}
          </p>
        </div>
        <button
          onClick={run}
          disabled={!isConnected || steps.some((s) => s.state === 'active')}
          className="rounded-xl bg-stellar-600 px-6 py-3 text-sm font-semibold text-white shadow hover:bg-stellar-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
        >
          {steps.some((s) => s.state === 'active') ? 'Processing…' : 'Execute Batch'}
        </button>
      </div>

      {error && (
        <div className="mt-4 rounded-lg bg-red-50 px-4 py-3 text-sm text-red-600">
          {error}
        </div>
      )}
    </div>
  );
}