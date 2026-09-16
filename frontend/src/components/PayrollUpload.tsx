import React, { useState, useCallback, useRef } from 'react';
import type { DisbursementRow } from '../types';

interface Props {
  onParsed: (rows: DisbursementRow[], file: File) => void;
}

/**
 * Drop-zone / click-to-upload component that parses a CSV into
 * { recipient, amount, memo } rows via PapaParse.
 */
export default function PayrollUpload({ onParsed }: Props) {
  const [dragging, setDragging] = useState(false);
  const [preview, setPreview] = useState<DisbursementRow[]>([]);
  const [fileName, setFileName] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const parse = useCallback(
    async (file: File) => {
      setError(null);
      setFileName(file.name);
      const Papa = await import('papaparse');
      Papa.default.parse(file, {
        header: true,
        skipEmptyLines: true,
        transformHeader: (h: string) => h.trim().toLowerCase(),
        complete(results) {
          const rows: DisbursementRow[] = (results.data as Record<string, string>[]).map((r) => {
            const recipient = r['recipient'] ?? r['address'] ?? r['stellar_address'] ?? r['to'] ?? '';
            const amount = r['amount'] ?? r['salary'] ?? r['pay'] ?? '';
            const memo = r['memo'] ?? r['note'] ?? '';
            return { recipient, amount, memo };
          });
          const invalid = rows.find(
            (r) =>
              !r.recipient.trim() ||
              !r.amount.trim() ||
              !/^[GC][A-Z2-7]{55}$/.test(r.recipient.trim()),
          );
          if (invalid) {
            setError(
              'Some rows have an invalid recipient Stellar address (must start with G or C, length 56).',
            );
          }
          setPreview(rows.slice(0, 10));
          onParsed(rows, file);
        },
        err(err) {
          setError(err.message);
        },
      });
    },
    [onParsed],
  );

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setDragging(false);
      const file = e.dataTransfer.files[0];
      if (file && file.name.endsWith('.csv')) {
        parse(file);
      } else {
        setError('Please drop a .csv file');
      }
    },
    [parse],
  );

  const handleChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (file) parse(file);
    },
    [parse],
  );

  return (
    <div>
      <div
        onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
        onDragLeave={() => setDragging(false)}
        onDrop={handleDrop}
        onClick={() => inputRef.current?.click()}
        className={`cursor-pointer rounded-2xl border-2 border-dashed p-12 text-center transition-colors ${
          dragging
            ? 'border-stellar-500 bg-stellar-50'
            : 'border-stellar-200 bg-white hover:border-stellar-400'
        }`}
      >
        <p className="text-lg font-semibold text-stellar-700">
          {fileName ? fileName : 'Upload Payroll CSV'}
        </p>
        <p className="mt-1 text-sm text-stellar-400">
          Required columns: <code className="font-mono text-stellar-600">recipient, amount, memo</code>
        </p>
        <p className="mt-3 text-xs text-stellar-300">
          {preview.length > 0 ? `${preview.length} rows parsed` : 'Drag & drop or click'}
        </p>
        <input
          ref={inputRef}
          type="file"
          accept=".csv"
          className="hidden"
          onChange={handleChange}
        />
      </div>
      {error && (
        <div className="mt-3 rounded-lg bg-red-50 px-4 py-3 text-sm text-red-600">
          {error}
        </div>
      )}
      {preview.length > 0 && (
        <div className="mt-6 overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="bg-stellar-50 text-stellar-600">
              <tr>
                <th className="px-4 py-2">Recipient</th>
                <th className="px-4 py-2">Amount</th>
                <th className="px-4 py-2">Memo</th>
              </tr>
            </thead>
            <tbody>
              {preview.map((r, i) => (
                <tr key={i} className="border-t border-stellar-100">
                  <td className="px-4 py-2 font-mono text-[11px]">
                    {r.recipient.slice(0, 12)}…{r.recipient.slice(-4)}
                  </td>
                  <td className="px-4 py-2">{r.amount}</td>
                  <td className="px-4 py-2 text-stellar-500">{r.memo || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="mt-2 text-[10px] text-stellar-400">Showing first {preview.length} rows</p>
        </div>
      )}
    </div>
  );
}