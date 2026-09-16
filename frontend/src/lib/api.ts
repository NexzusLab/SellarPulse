import type { BatchStatus, PayrollBatch, ProofGenerationResponse } from '../types';

const API_BASE = '/api';

function headers(): Record<string, string> {
  const apiKey = localStorage.getItem('stellarpulse_api_key') ?? 'dev_public_key_do_not_use_in_prod';
  return { 'Content-Type': 'application/json', 'x-api-key': apiKey };
}

async function request<T>(path: string, opts: RequestInit = {}): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    ...opts,
    headers: { ...headers(), ...opts.headers },
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(body.error ?? res.statusText);
  }
  return res.json() as Promise<T>;
}

// ---------------------------------------------------------------------------
// Payroll API
// ---------------------------------------------------------------------------

export async function createBatch(opts: {
  employer: string;
  currency: 'USDC' | 'PYUSD';
  disbursements: Array<{ recipient: string; amount: string; memo?: string }>;
}): Promise<{ txHash: string; batchId: string; status: BatchStatus }> {
  return request('/payroll/batch', {
    method: 'POST',
    body: JSON.stringify(opts),
  });
}

export async function getBatchStatus(batchId: string): Promise<PayrollBatch> {
  return request(`/payroll/status/${batchId}`);
}

// ---------------------------------------------------------------------------
// Proof API
// ---------------------------------------------------------------------------

export async function generateSolvencyProof(opts: {
  batchId: string;
  employer: string;
  totalLiability: string;
  vkId: string;
  salaries: Array<{ recipient: string; amount: string; nonce: string }>;
}): Promise<ProofGenerationResponse> {
  return request('/proof/generate', {
    method: 'POST',
    body: JSON.stringify(opts),
  });
}

export async function getProofStatus(proofId: string): Promise<{ proofId: string; status: string }> {
  return request(`/proof/${proofId}`);
}

// ---------------------------------------------------------------------------
// Health check
// ---------------------------------------------------------------------------

export async function healthCheck(): Promise<{ status: string; uptime: number }> {
  const res = await fetch(`${API_BASE.replace('/api', '')}/health`);
  return res.json() as Promise<{ status: string; uptime: number }>;
}