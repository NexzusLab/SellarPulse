import { Address } from '@stellar/stellar-sdk';

// ---------------------------------------------------------------------------
// Domain payloads shared across routes & services
// ---------------------------------------------------------------------------

export interface DisbursementInput {
  /** Stellar account (G...) or contract id (C...) of the employee */
  recipient: string;
  /** Amount in smallest token unit (e.g. 7 decimals for USDC) */
  amount: string;
  memo?: string;
}

export interface CreateBatchRequest {
  employer: string;
  currency: 'USDC' | 'PYUSD';
  disbursements: DisbursementInput[];
}

export interface GenerateProofRequest {
  batchId: string;
  employer: string;
  totalLiability: string;
  vkId: string;
}

export interface BatchStatusResponse {
  batchId: string; // on-chain batch id (BytesN<32> hex)
  status:
    | 'PENDING'
    | 'PROOF_GENERATED'
    | 'SUBMITTED'
    | 'EXECUTED'
    | 'FAILED'
    | 'CANCELLED'
    | 'UNKNOWN';
  totalAmount: string;
  disbursementCount: number;
  zkProofId?: string;
  chainTxHash?: string;
  executedAt?: string;
  error?: string;
  payouts?: PayoutRecordResponse[];
}

export interface PayoutRecordResponse {
  employee: string;
  amount: string;
  timestamp: string;
  txHash: string;
}

export interface SorobanEventRecord {
  contractId: string;
  topic: string[];
  payload: string;
  txHash: string;
  ledger: string;
  timestamp: string;
}

// ---------------------------------------------------------------------------
// Sed intended result of parsing a Soroban event topic
// ---------------------------------------------------------------------------
export type ParsedEvent =
  | { type: 'PAYOUT'; employee: string; amount: bigint }
  | { type: 'BATCH'; batchId: string; total: bigint }
  | { type: 'BATCH_OK'; batchId: string; total: bigint }
  | { type: 'DEPOSIT'; depositor: string; amount: bigint };

export function addressToString(a: Address): string {
  try {
    return a.toString();
  } catch {
    return `__unknown__${Date.now()}`;
  }
}

export function isValidStellarAddress(value: string): boolean {
  try {
    Address.fromString(value);
    return true;
  } catch {
    return false;
  }
}