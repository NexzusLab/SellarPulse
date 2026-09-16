import React, { useEffect, useState } from 'react';
import { useFreighter } from '../hooks/useFreighter';

interface PayoutHistoryRow {
  batchId: string;
  amount: string;
  timestamp: string;
  status: 'CONFIRMED' | 'PENDING' | 'FAILED';
}

// Demo data — replaced by a real DB query in production.
const DEMO_PAYOUTS: PayoutHistoryRow[] = [
  { batchId: '0x9f3a…2c74', amount: '4,250.00 USDC', timestamp: '2026-09-01', status: 'CONFIRMED' },
  { batchId: '0x11be…08a1', amount: '4,250.00 USDC', timestamp: '2026-08-01', status: 'CONFIRMED' },
  { batchId: '0x8cd0…45fe', amount: '4,125.00 USDC', timestamp: '2026-07-01', status: 'CONFIRMED' },
];

export default function EmployeeDashboard() {
  const { isConnected, address } = useFreighter();
  const [offramp, setOfframp] = useState(false);
  const [history] = useState<PayoutHistoryRow[]>(DEMO_PAYOUTS);

  return (
    <div className="mx-auto max-w-3xl px-6 py-10">
      <header className="mb-8">
        <h1 className="text-3xl font-extrabold text-stellar-950">Employee Dashboard</h1>
        <p className="mt-1 text-sm text-stellar-500">
          {address ? `Connected: ${address.slice(0, 8)}…${address.slice(-4)}` : 'Connect your wallet to view salary history.'}
        </p>
      </header>

      <section className="rounded-2xl bg-white p-6 shadow-card">
        <h2 className="text-lg font-bold text-stellar-900">Incoming Salary History</h2>
        {!isConnected ? (
          <p className="mt-4 text-sm text-stellar-400">
            Your earnings are private — connect your Freighter wallet to reveal them.
          </p>
        ) : (
          <table className="mt-4 w-full text-left text-sm">
            <thead className="text-xs uppercase text-stellar-400">
              <tr>
                <th className="py-2">Batch</th>
                <th className="py-2">Amount</th>
                <th className="py-2">Paid</th>
                <th className="py-2 text-right">Status</th>
              </tr>
            </thead>
            <tbody>
              {history.map((p) => (
                <tr key={p.batchId} className="border-t border-stellar-100">
                  <td className="py-3 font-mono text-xs">{p.batchId}</td>
                  <td className="py-3 font-semibold">{p.amount}</td>
                  <td className="py-3 text-stellar-500">{p.timestamp}</td>
                  <td className="py-3 text-right">
                    <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-semibold text-emerald-700">
                      {p.status}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <div className="mt-8 rounded-2xl bg-white p-6 shadow-card">
        <h2 className="text-lg font-bold text-stellar-900">Fiat Off-ramp</h2>
        <p className="mt-2 text-sm text-stellar-500">
          Instant cash-out to a local bank via SEP-24 (anchor deposit flow) or SEP-31
          (payout corridor).
        </p>
        <div className="mt-4 flex gap-2">
          <button
            disabled={!isConnected}
            onClick={() => setOfframp(true)}
            className="rounded-xl bg-stellar-600 px-5 py-2.5 text-sm font-semibold text-white hover:bg-stellar-700 disabled:opacity-50 transition-colors"
          >
            Cash out via anchor
          </button>
          <button
            disabled
            className="rounded-xl bg-stellar-50 px-5 py-2.5 text-sm font-semibold text-stellar-400"
            title="Coming soon"
          >
            SEP-31 corridor
          </button>
        </div>
        {offramp && (
          <div className="mt-4 rounded-lg bg-stellar-50 px-4 py-3 text-xs text-stellar-600">
            Opening anchor flow… (production wiring to a SEP-24 anchor is out of scope
            for the hackathon build).
          </div>
        )}
      </div>
    </div>
  );
}