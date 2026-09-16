export interface DisbursementRow {
  recipient: string;
  amount: string;
  memo: string;
}

export interface PayrollBatch {
  batchId: string;
  txHash: string;
  status: BatchStatus;
  totalAmount: string;
  disbursementCount: number;
  currency: string;
  zkProofId?: string;
  createdAt: string;
  executedAt?: string;
  error?: string;
}

export type BatchStatus =
  | 'PENDING'
  | 'PROOF_GENERATED'
  | 'SUBMITTED'
  | 'EXECUTED'
  | 'FAILED'
  | 'CANCELLED'
  | 'UNKNOWN';

export interface ProofGenerationResponse {
  proofId: string;
  merkleRoot: string;
  proofBytesHex: string;
  publicSignals: string[];
  vkHash: string;
  totalDisbursed: string;
}

export interface VaultBalance {
  balance: string;
  asset: string;
}

export interface WalletContext {
  address: string | null;
  isConnected: boolean;
  connect: () => Promise<void>;
  disconnect: () => void;
  signTransaction: (tx: string) => Promise<string>;
  network: string;
}