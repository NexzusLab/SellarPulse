import { Router } from 'express';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { apiKeyAuth } from '../middleware/auth';
import { strictRateLimiter } from '../middleware/rateLimit';
import { createPayrollBatch } from '../services/stellar';
import { PayrollJobData, enqueueOrThrow, JobType, payrollQueue } from '../services/queue';
import type { BatchStatusResponse } from '../types';

const router = Router();

const disbursementSchema = z.object({
  recipient: z.string().regex(/^[GC][A-Z2-7]{55}$/, 'Invalid Stellar address'),
  amount: z.string().regex(/^\d+$/, 'Amount must be an integer in base token units'),
  memo: z.string().max(64).optional(),
});

const createBatchSchema = z.object({
  employer: z.string().regex(/^[GC][A-Z2-7]{55}$/, 'Invalid employer address'),
  currency: z.enum(['USDC', 'PYUSD']).default('USDC'),
  disbursements: z.array(disbursementSchema).min(1).max(100),
});

// ---------------------------------------------------------------------------
// POST /api/payroll/batch
// Creates an on-chain payroll batch from a list of disbursements.
// ---------------------------------------------------------------------------
router.post('/batch', apiKeyAuth, strictRateLimiter, async (req, res, next) => {
  try {
    const body = createBatchSchema.parse(req.body);

    const disbursements = body.disbursements.map((d) => ({
      recipient: d.recipient,
      amount: BigInt(d.amount),
      memo: d.memo ?? '',
    }));

    const { txHash, batchId } = await createPayrollBatch({
      employer: body.employer,
      token: body.currency,
      disbursements,
    });

    // Enqueue downstream prove + submit jobs
    const runId = randomUUID();
    const jobData: PayrollJobData = {
      batchId,
      runId,
      employer: body.employer,
    };
    await enqueueOrThrow(JobType.EXECUTE_BATCH, jobData);

    res.status(201).json({
      txHash,
      batchId,
      jobId: `run:${runId}`,
      status: 'SUBMITTED',
    });
  } catch (err) {
    next(err);
  }
});

// ---------------------------------------------------------------------------
// POST /api/payroll/queue
// Schedule a payout for processing (idempotent via runId).
// ---------------------------------------------------------------------------
router.post('/queue', apiKeyAuth, async (req, res, next) => {
  try {
    const schema = z.object({
      batchId: z.string().regex(/^[0-9a-fA-F]{64}$/),
      employer: z.string(),
      runId: z.string().optional(),
    });
    const body = schema.parse(req.body);

    const jobData: PayrollJobData = {
      batchId: body.batchId,
      runId: body.runId ?? randomUUID(),
      employer: body.employer,
    };
    const outcome = await enqueueOrThrow(JobType.SUBMIT_BATCH, jobData);

    if (outcome === 'duplicate') {
      res.status(200).json({ message: 'Job already queued', runId: jobData.runId });
      return;
    }
    res.status(202).json({ jobId: `run:${jobData.runId}` });
  } catch (err) {
    next(err);
  }
});

// ---------------------------------------------------------------------------
// GET /api/payroll/status/:batchId
// Returns DB status plus queue position for a batch.
// ---------------------------------------------------------------------------
router.get('/status/:batchId', apiKeyAuth, async (req, res, next) => {
  try {
    const batchId = req.params.batchId;
    const result = await payrollQueue.getJob(`run:${batchId}`);

    const response: BatchStatusResponse = {
      batchId,
      status: result ? 'SUBMITTED' : 'UNKNOWN',
      totalAmount: '0', // populated from DB in production
      disbursementCount: 0,
      chainTxHash: result?.returnvalue as string | undefined,
      error: result?.failedReason as string | undefined,
    };
    res.json(response);
  } catch (err) {
    next(err);
  }
});

router.post('/mock/success', apiKeyAuth, (_req, res) => {
  res.json({ ok: true });
});

export default router;