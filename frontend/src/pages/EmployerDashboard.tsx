import React, { useState } from 'react';
import PayrollUpload from '../components/PayrollUpload';
import BatchPayout from '../components/BatchPayout';
import type { DisbursementRow } from '../types';

export default function EmployerDashboard() {
  const [rows, setRows] = useState<DisbursementRow[]>([]);
  const [currency, setCurrency] = useState<'USDC' | 'PYUSD'>('USDC');
  const [completedBatch, setCompletedBatch] = useState<string | null>(null);

  return (
    <div className="mx-auto max-w-5xl px-6 py-10">
      <header className="mb-8">
        <h1 className="text-3xl font-extrabold text-stellar-950">Employer Portal</h1>
        <p className="mt-1 text-sm text-stellar-500">
          Upload employee payroll, generate a ZK solvency proof, and release funds in one flow.
        </p>
      </header>

      <div className="grid gap-8 lg:grid-cols-2">
        <section className="space-y-6">
          <div className="rounded-2xl bg-white p-4">
            <label className="text-sm font-semibold text-stellar-700">Payroll currency</label>
            <div className="mt-2 flex gap-2">
              {(['USDC', 'PYUSD'] as const).map((c) => (
                <button
                  key={c}
                  onClick={() => setCurrency(c)}
                  className={`rounded-lg px-4 py-2 text-sm font-semibold transition-colors ${
                    currency === c
                      ? 'bg-stellar-600 text-white'
                      : 'bg-stellar-50 text-stellar-600 hover:bg-stellar-100'
                  }`}
                >
                  {c}
                </button>
              ))}
            </div>
          </div>

          <PayrollUpload onParsed={setRows} />
        </section>

        <section className="space-y-6">
          <BatchPayout
            rows={rows}
            currency={currency}
            onComplete={setCompletedBatch}
          />

          {completedBatch && (
            <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-700">
              Batch executed! On-chain batch id:{' '}
              <code className="font-mono text-xs">{completedBatch}</code>
            </div>
          )}

          <div className="rounded-2xl bg-white p-4 shadow-card">
            <h4 className="text-sm font-semibold text-stellar-700">ZK Compliance</h4>
            <p className="mt-2 text-xs leading-relaxed text-stellar-500">
              Before execution, StellarPulse produces a Groth16 proof that the batch is
              backed by sufficient vault liability — without exposing individual salaries
              or headcount in the proof itself.
            </p>
          </div>
        </section>
      </div>
    </div>
  );
}