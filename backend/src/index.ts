import cors from 'cors';
import express, { type NextFunction, type Request, type Response } from 'express';
import helmet from 'helmet';
import { pinoHttp } from 'pino-http';
import { ZodError } from 'zod';
import { config } from './config';
import { rateLimiter } from './middleware/rateLimit';
import payrollRoutes from './routes/payroll';
import proofRoutes from './routes/proof';
import { executeBatch } from './services/stellar';
import { startPayrollWorkers } from './services/queue';
import { connection } from './services/queue';

const app = express();

app.use(helmet());
app.use(cors({ origin: config.nodeEnv === 'production' ? 'https://app.stellarpulse.dev' : true }));
app.use(express.json({ limit: '2mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(pinoHttp({ name: 'stellarpulse-api' }));
app.use('/api', rateLimiter);

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------
app.get('/health', (_req, res) => {
  res.json({ status: 'ok', uptime: process.uptime() });
});

app.use('/api/payroll', payrollRoutes);
app.use('/api/proof', proofRoutes);

// ---------------------------------------------------------------------------
// Error handling
// ---------------------------------------------------------------------------
app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
  if (err instanceof ZodError) {
    res.status(400).json({ error: 'Validation failed', issues: err.issues });
    return;
  }
  if (err instanceof Error) {
    res.status(500).json({ error: err.message });
    return;
  }
  res.status(500).json({ error: 'Unknown error' });
});

// ---------------------------------------------------------------------------
// Payroll queue worker — relays approved batches to the on-chain vault.
// ---------------------------------------------------------------------------
async function startWorker() {
  await startPayrollWorkers(async (job) => {
    const { batchId } = job.data;
    switch (job.name) {
      case 'execute-batch': {
        const result = await executeBatch({ batchId });
        job.updateProgress(100);
        await job.updateData({ ...job.data, proofId: result.txHash });
        break;
      }
      default:
        throw new Error(`Unhandled job type: ${job.name}`);
    }
  });
}

async function main() {
  try {
    await connection.echo('conn');
    console.log('[redis] connected');
  } catch (err) {
    console.warn('[redis] unavailable — run `docker compose up redis` for queues', (err as Error).message);
  }

  if (config.nodeEnv !== 'test') {
    await startWorker();
  }

  app.listen(config.port, config.host, () => {
    console.log(`[api] StellarPulse backend listening on http://${config.host}:${config.port}`);
  });
}

main().catch((err) => {
  console.error('Fatal startup error:', err);
  process.exit(1);
});

export default app;