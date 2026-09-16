import { Queue, Worker, type Job } from 'bullmq';
import IORedis from 'ioredis';
import { config } from '../config';

const connection = new IORedis(config.redis.url, { maxRetriesPerRequest: null });

export enum JobType {
  GENERATE_PROOF = 'generate-proof',
  SUBMIT_BATCH = 'submit-batch',
  EXECUTE_BATCH = 'execute-batch',
}

export interface PayrollJobData {
  batchId: string; // on-chain batch hex id
  runId: string; // idempotency key
  employer: string;
  proofId?: string;
}

export const payrollQueue = new Queue<PayrollJobData>('stellarpulse-payroll', {
  connection,
  defaultJobOptions: {
    attempts: 3,
    backoff: { type: 'exponential', delay: 3000 },
    removeOnComplete: { age: 60 * 60 * 24 },
    removeOnFail: { age: 60 * 60 * 24 * 3 },
  },
});

export { connection };

// Idempotency guard — one runId can only be enqueued once.
const enqueued = new Set<string>();

export async function enqueueOrThrow(
  type: JobType,
  data: PayrollJobData,
): Promise<Job<PayrollJobData> | 'duplicate'> {
  if (enqueued.has(data.runId)) {
    return 'duplicate';
  }
  enqueued.add(data.runId);
  return payrollQueue.add(type, data, { jobId: `run:${data.runId}` });
}

export async function startPayrollWorkers(handler: (job: Job<PayrollJobData>) => Promise<void>): Promise<Worker<PayrollJobData>> {
  const worker = new Worker<PayrollJobData>('stellarpulse-payroll', handler, {
    connection,
    concurrency: 4,
  });

  worker.on('failed', (job, err) => {
    console.error(`[queue] job ${job?.id} failed:`, err.message);
  });
  worker.on('completed', (job) => {
    console.log(`[queue] job ${job.id} completed`);
  });

  return worker;
}