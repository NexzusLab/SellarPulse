import {
  Account,
  Address,
  BASE_FEE,
  Contract,
  Horizon,
  Keypair,
  Networks,
  Operation,
  SorobanRpc,
  TransactionBuilder,
  xdr,
} from '@stellar/stellar-sdk';
import { config } from '../config';

// ---------------------------------------------------------------------------
// Typed helpers around @stellar/stellar-sdk for Soroban interactions
// ---------------------------------------------------------------------------

function getServer(): SorobanRpc.Server {
  return new SorobanRpc.Server(config.stellar.rpcUrl, {
    allowHttp: config.nodeEnv !== 'production',
  });
}

function getHorizon(): Horizon.Server {
  return new Horizon.Server('https://horizon-testnet.stellar.org');
}

function getSponsoringAccount(): Keypair {
  const source = Keypair.fromSecret(config.relay.secret);
  if (config.relay.publicKey !== source.publicKey()) {
    throw new Error('RELAY_SECRET and RELAY_PUBLIC do not match');
  }
  return source;
}

export async function fundTestnet(publicKey: string): Promise<string> {
  const url = `${config.stellar.friendbotUrl}?addr=${encodeURIComponent(publicKey)}`;
  const res = await fetch(url, { method: 'GET' });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Friendbot funding failed: ${res.status} ${body}`);
  }
  const json = (await res.json()) as { hash?: string };
  return json.hash ?? 'pending';
}

export async function getAccountBalance(publicKey: string): Promise<Array<{ asset: string; balance: string }>> {
  const account = await getHorizon().loadAccount(publicKey);
  return (account.balances as Array<{ asset_type: string; asset_code?: string; balance: string }>).map(
    (b) => ({
      asset: b.asset_type === 'native' ? 'XLM' : (b.asset_code ?? 'unknown'),
      balance: b.balance,
    }),
  );
}

// ---------------------------------------------------------------------------
// Contract invocation primitives
// ---------------------------------------------------------------------------

export interface SorobanInvokeResult {
  txHash: string;
  getResult: () => Promise<xdr.ScVal>;
}

async function prepareInvocation(opts: {
  contractId: string;
  method: string;
  args: Array<xdr.ScVal>;
  source: Keypair;
}): Promise<Awaited<ReturnType<SorobanRpc.Server['prepareTransaction']>>> {
  const server = getServer();
  const account = await server.getAccount(opts.source.publicKey());

  const contract = new Contract(opts.contractId);

  const tx = new TransactionBuilder(account, {
    fee: BASE_FEE,
    networkPassphrase: config.stellar.networkPassphrase,
  })
    .setTimeout(30)
    .addOperation(contract.call(opts.method, ...opts.args))
    .build();

  const prepared = await server.prepareTransaction(tx);
  return prepared;
}

export async function invokeContract(opts: {
  contractId: string;
  method: string;
  args: Array<xdr.ScVal>;
  source: Keypair;
}): Promise<SorobanInvokeResult> {
  const server = getServer();
  const prepared = await prepareInvocation(opts);

  prepared.sign(opts.source);
  const sendResponse = await server.sendTransaction(prepared);
  if (sendResponse.status === 'ERROR') {
    throw new Error(`Soroban send error: ${sendResponse.errorResult?.result().toString() ?? 'unknown'}`);
  }

  const txHash = sendResponse.hash;
  return { txHash, getResult: () => pollResult(server, txHash) };
}

async function pollResult(
  server: SorobanRpc.Server,
  txHash: string,
  attempts = 20,
): Promise<xdr.ScVal> {
  for (let i = 0; i < attempts; i++) {
    const result = await server.getTransaction(txHash);
    switch (result.status) {
      case SorobanRpc.Api.GetTransactionStatus.SUCCESS:
        if (!result.returnValue) {
          throw new Error('No soroban return value found');
        }
        return result.returnValue;
      case SorobanRpc.Api.GetTransactionStatus.FAILED:
        throw new Error('Transaction failed on-chain');
      default:
        break; // NOT_FOUND — keep polling
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
  throw new Error(`Transaction ${txHash} did not finalize within timeout`);
}

// ---------------------------------------------------------------------------
// High-level payroll operations
// ---------------------------------------------------------------------------

export async function depositToVault(opts: {
  employer: string;
  amount: string; // in base units (i128)
}): Promise<SorobanInvokeResult> {
  return invokeContract({
    contractId: config.contracts.payrollVault,
    method: 'deposit',
    args: [
      new Address(opts.employer).toScVal(),
      xdr.ScVal.scvI128(int128(opts.amount)),
    ],
    source: getSponsoringAccount(),
  });
}

export async function createPayrollBatch(opts: {
  employer: string;
  token: string;
  disbursements: Array<{ recipient: string; amount: bigint; memo: string }>;
}): Promise<{ txHash: string; batchId: string }> {
  const disbursementVals = opts.disbursements.map((d) =>
    xdr.ScVal.scvVec([
      new Address(d.recipient).toScVal(),
      xdr.ScVal.scvI128(int128(d.amount.toString())),
      xdr.ScVal.scvString(d.memo),
    ]),
  );

  const result = await invokeContract({
    contractId: config.contracts.payrollVault,
    method: 'create_payroll_batch',
    args: [
      new Address(opts.employer).toScVal(),
      xdr.ScVal.scvVec(disbursementVals),
    ],
    source: getSponsoringAccount(),
  });

  const batchScVal = await result.getResult();
  return {
    txHash: result.txHash,
    batchId: scValToHex(batchScVal),
  };
}

export async function executeBatch(opts: {
  batchId: string; // hex-encoded BytesN<32>
}): Promise<SorobanInvokeResult> {
  return invokeContract({
    contractId: config.contracts.payrollVault,
    method: 'execute_batch',
    args: [hexBytesToScVal(opts.batchId)],
    source: getSponsoringAccount(),
  });
}

export async function getVaultBalance(): Promise<bigint> {
  const server = getServer();
  const contract = new Contract(config.contracts.payrollVault);
  const account = await server.getAccount(config.relay.publicKey);

  const tx = new TransactionBuilder(account, {
    fee: BASE_FEE,
    networkPassphrase: config.stellar.networkPassphrase,
  })
    .setTimeout(30)
    .addOperation(contract.call('get_balance'))
    .build();

  const result = await server.simulateTransaction(tx);
  if (SorobanRpc.Api.isSimulationSuccess(result) && result.result?.retval) {
    return bigIntFromScVal(result.result.retval);
  }
  throw new Error('Simulation returned no result');
}

export async function verifyProofOnChain(opts: {
  verifierContract: string;
  vkId: string;
  proofHex: string;
  publicInputsHex: string;
}): Promise<{ txHash: string; valid: boolean }> {
  const result = await invokeContract({
    contractId: opts.verifierContract,
    method: 'submit_proof',
    args: [
      new Address(config.relay.publicKey).toScVal(),
      hexBytesToScVal(opts.vkId),
      hexBytesToScVal(opts.proofHex, 64),
      xdr.ScVal.scvBytes(Buffer.from(opts.publicInputsHex, 'hex')),
    ],
    source: getSponsoringAccount(),
  });

  const proofId = await result.getResult();
  return { txHash: result.txHash, valid: scValToHex(proofId).length === 64 };
}

// ---------------------------------------------------------------------------
// ScVal <-> JS conversion helpers
// ---------------------------------------------------------------------------

export function scValToHex(scval: xdr.ScVal): string {
  switch (scval.switch().name) {
    case 'scvBytes':
      return scval.bytes().toString('hex');
    case 'scvString':
      return scval.str().toString();
    case 'scvSymbol':
      return scval.sym().toString();
    case 'scvU32':
      return scval.u32().toString();
    case 'scvI128':
      return scval.i128().lo().toString();
    default:
      throw new Error(`Unsupported ScVal kind: ${scval.switch().name}`);
  }
}

export function hexBytesToScVal(hex: string, length = 32): xdr.ScVal {
  const buf = Buffer.from(hex, 'hex');
  if (buf.byteLength !== length) {
    throw new Error(`Expected ${length} bytes, got ${buf.byteLength}`);
  }
  // pad to next power-of-two register size for ScBytes
  const padded = Buffer.alloc(64);
  buf.copy(padded);
  return xdr.ScVal.scvBytes(padded);
}

export function int128(value: string): xdr.Int128Parts {
  const bn = BigInt(value);
  const lo = BigInt.asUintN(64, bn);
  const hi = BigInt.asUintN(64, bn >> 64n);
  return new xdr.Int128Parts({
    lo: xdr.Uint64.fromString(lo.toString()),
    hi: xdr.Int64.fromString(hi.toString()),
  });
}

export function bigIntFromScVal(scval: xdr.ScVal): bigint {
  if (scval.switch().name === 'scvI128') {
    const parts = scval.value() as xdr.Int128Parts;
    const lo = BigInt(parts.lo()!.toString());
    const hi = BigInt(parts.hi()!.toString());
    return (hi << 64n) | lo;
  }
  throw new Error(`Expected I128, got ${scval.switch().name}`);
}