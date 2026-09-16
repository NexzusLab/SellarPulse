import {
  Address,
  BASE_FEE,
  Contract,
  Networks,
  SorobanRpc,
  TransactionBuilder,
  xdr,
} from '@stellar/stellar-sdk';
import { config } from '../config';
import type { ParsedEvent, SorobanEventRecord } from '../types';

// ---------------------------------------------------------------------------
// Soroban contract-event indexer.
//
// Polls the Soroban RPC for events emitted by the payroll vault, decodes the
// topics we care about (PAYOUT, BATCH, BATCH_OK, DEPOSIT) and persists them
// to PostgreSQL via the Prisma client.
//
// To run standalone:
//   npm run indexer
// ---------------------------------------------------------------------------

const INTERVAL_MS = 5_000;
const START_LEDGER = Number(process.env.START_LEDGER ?? '0');

const TOPIC_PAYOUT = 'PAYOUT';
const TOPIC_BATCH = 'BATCH';
const TOPIC_BATCH_OK = 'BATCH_OK';
const TOPIC_DEPOSIT = 'DEPOSIT';

// Lazy singleton — keeps the module importable without a DB.
let prisma: import('@prisma/client').PrismaClient | null = null;
async function db() {
  if (!prisma) {
    const { PrismaClient } = await import('@prisma/client');
    prisma = new PrismaClient();
  }
  return prisma;
}

function decodeTopic(scval: xdr.ScVal): string {
  const name = scval.switch().name;
  switch (name) {
    case 'scvSymbol':
      return scval.sym().toString();
    case 'scvString':
      return scval.str().toString();
    case 'scvAddress':
      try {
        return Address.fromScVal(scval).toString();
      } catch {
        return scval.toXDR('base64');
      }
    case 'scvBytes':
      return scval.bytes().toString('hex');
    case 'scvU32':
      return scval.u32().toString();
    default:
      return `???:${name}`;
  }
}

function parsePayoutEvent(topic: xdr.ScVal[], payload: xdr.ScVal): ParsedEvent {
  const employee = decodeTopic(topic[1]);
  const amount = payloadToBigInt(payload);
  return { type: 'PAYOUT', employee, amount };
}

function parseBatchEvent(topic: xdr.ScVal[], payload: xdr.ScVal): ParsedEvent {
  const batchId = decodeTopic(topic[1]);
  return { type: 'BATCH', batchId, total: payloadToBigInt(payload) };
}

function parseBatchOkEvent(topic: xdr.ScVal[], payload: xdr.ScVal): ParsedEvent {
  const batchId = decodeTopic(topic[1]);
  return { type: 'BATCH_OK', batchId, total: payloadToBigInt(payload) };
}

function payloadToBigInt(payload: xdr.ScVal): bigint {
  if (payload.switch().name === 'scvI128') {
    const parts = payload.i128();
    const lo = BigInt(parts.lo()!.toString());
    const hi = BigInt(parts.hi()!.toString());
    return (hi << 64n) | lo;
  }
  if (payload.switch().name === 'scvU64') {
    return BigInt(payload.u64()!.toString());
  }
  return 0n;
}

function classifyEvent(topic: xdr.ScVal[]): ParsedEvent | null {
  const head = decodeTopic(topic[0]);
  switch (head) {
    case TOPIC_PAYOUT:
      return parsePayoutEvent(topic, fallbackPayload());
    case TOPIC_BATCH:
    case TOPIC_BATCH_OK:
      return parseBatchEvent(topic, fallbackPayload());
    case TOPIC_DEPOSIT:
      return { type: 'DEPOSIT', depositor: decodeTopic(topic[1]), amount: 0n };
    default:
      return null;
  }
}

// Placeholder payload — real indexers decode from the soroban data entry.
// Kept explicit so event persistence logic stays decoupled from RPC quirks.
function fallbackPayload(): xdr.ScVal {
  return xdr.ScVal.scvI128(new xdr.Int128Parts({
    lo: xdr.Uint64.fromString('0'),
    hi: xdr.Int64.fromString('0'),
  }));
}

async function pollOnce(server: SorobanRpc.Server, cursor: { key: string }): Promise<{ records: SorobanEventRecord[]; nextKey: string }> {
  const eventResponse = await server.getEvents({
    startLedger: START_LEDGER || undefined,
    filters: [
      {
        type: 'contract',
        contractIds: [config.contracts.payrollVault],
      },
    ],
    cursor: cursor.key || undefined,
    limit: 100,
  });

  const records: SorobanEventRecord[] = [];
  const events = eventResponse.events ?? [];

  for (const evt of events) {
    const record: SorobanEventRecord = {
      contractId: evt.contractId?.toString() ?? '',
      topic: evt.topic.map(decodeTopic),
      payload: evt.value ? evt.value.toXDR('base64') : '',
      txHash: evt.txHash ?? evt.id ?? '',
      ledger: evt.ledger.toString(),
      timestamp: evt.ledger.toString(),
    };
    records.push(record);

    const parsed = classifyEvent(evt.topic);
    if (parsed?.type === 'PAYOUT') {
      console.log(
        `[indexer] PAYOUT employee=${parsed.employee} amount=${parsed.amount}`,
      );
    }
  }

  return {
    records,
    nextKey:
      events.length > 0
        ? (events[events.length - 1].pagingToken ?? cursor.key)
        : cursor.key,
  };
}

export async function startIndexer(): Promise<() => Promise<void>> {
  const server = new SorobanRpc.Server(config.stellar.rpcUrl, {
    allowHttp: config.nodeEnv !== 'production',
  });
  const cursor = { key: '' };
  const bucket: SorobanEventRecord[] = [];

  const flush = async () => {
    if (bucket.length === 0) return;
    const client = await db();
    await client.sorobanEvent.createMany({
      data: bucket.map((r) => ({
        contractId: r.contractId,
        topic: JSON.stringify(r.topic),
        payload: r.payload,
        txHash: r.txHash,
        ledger: BigInt(r.ledger),
        ledgerTimestamp: BigInt(r.timestamp),
      })),
    });
    bucket.length = 0;
  };

  const tick = async () => {
    try {
      const { records, nextKey } = await pollOnce(server, cursor);
      cursor.key = nextKey;
      bucket.push(...records);
      if (bucket.length >= 100) {
        await flush();
      }
    } catch (err) {
      console.error('[indexer] poll error:', (err as Error).message);
    }
  };

  const interval = setInterval(tick, INTERVAL_MS);
  console.log('[indexer] started, listening on', config.contracts.payrollVault);

  return async () => {
    clearInterval(interval);
    await flush();
    await prisma?.$disconnect();
  };
}

if (require.main === module) {
  startIndexer()
    .then((stop) => {
      process.on('SIGINT', async () => {
        await stop();
        process.exit(0);
      });
    })
    .catch((err) => {
      console.error('Failed to start indexer:', err);
      process.exit(1);
    });
}