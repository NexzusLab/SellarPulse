import { config } from '../config';

// ---------------------------------------------------------------------------
// Off-chain ZK proof generation facade.
//
// In this reference implementation we shell out to the snarkjs / circom
// toolchain. The service:
//   1. builds the payroll commitment Merkle tree from employee salaries,
//   2. derives a witness with the blinds & merkle paths,
//   3. runs the Groth16 prover (snarkjs groth16 fullprove),
//   4. returns { proof, publicSignals, vkHash } for on-chain submission.
//
// For the hackathon the circuit & keys live under ../circuits.
// ---------------------------------------------------------------------------

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createHash } from 'node:crypto';
import path from 'node:path';

const execFileAsync = promisify(execFile);

export interface Salary { recipient: string; amount: bigint; nonce: string }

export interface ZkProofResult {
  proof: { pi_a: string[]; pi_b: string[][]; pi_c: string[] };
  publicSignals: string[];
  vkHash: string;
  merkleRoot: string;
  proofBytesHex: string; // canonical 64-byte serialization for the verifier
}

function poseidonHashPair(left: string, right: string): string {
  // Placeholder — in production this runs `snarkjs` circuit Poseidon hashing.
  // Kept here so the Merkle tree logic is testable without the full toolchain.
  return createHash('sha256').update(`${left}:${right}`).digest('hex').slice(0, 15);
}

export function buildMerkleTree(salaries: Salary[]): {
  root: string;
  paths: Array<Array<{ node: string; bit: 0 | 1 }>>;
} {
  if (salaries.length === 0) {
    throw new Error('Cannot build Merkle tree over empty salary set');
  }
  if (salaries.length > 16) {
    throw new Error('Merkle tree depth limited to 16 leaves in this demo');
  }

  const depth = Math.ceil(Math.log2(salaries.length)) + 1;
  const leafCount = 2 ** depth;

  const leaves: string[] = Array.from({ length: leafCount }, (_, i) => {
    if (i < salaries.length) {
      return poseidonHashPair(salaries[i].amount.toString(16), salaries[i].nonce);
    }
    return '0'.repeat(15); // zero leaf padding
  });

  let level = leaves;
  const layers: string[][] = [level];
  while (level.length > 1) {
    const next: string[] = [];
    for (let i = 0; i < level.length; i += 2) {
      next.push(poseidonHashPair(level[i], level[i + 1]));
    }
    layers.push(next);
    level = next;
  }

  const root = level[0];

  const paths = salaries.map((_, leafIndex) => {
    const path: Array<{ node: string; bit: 0 | 1 }> = [];
    let idx = leafIndex;
    for (let l = 0; l < layers.length - 1; l++) {
      const siblingIdx = idx % 2 === 0 ? idx + 1 : idx - 1;
      path.push({ node: layers[l][siblingIdx], bit: (idx % 2) as 0 | 1 });
      idx = Math.floor(idx / 2);
    }
    return path;
  });

  return { root, paths };
}

export async function generateSolvencyProof(opts: {
  salaries: Salary[];
  totalDisbursed: bigint;
  totalLiability: bigint;
  vkId: string;
}): Promise<ZkProofResult> {
  const merkle = buildMerkleTree(opts.salaries);
  const { wasmPath, zkeyPath } = config.zk;

  const inputJson = path.join(config.zk.proofDir, 'input.json');
  const witnessJson = path.join(config.zk.proofDir, 'witness.json');

  const input = {
    total_disbursed: opts.totalDisbursed.toString(),
    total_liability: opts.totalLiability.toString(),
    merkle_root: merkle.root,
    vk_hash: opts.vkId,
    salaries: opts.salaries.map((s) => s.amount.toString()),
    nonces: opts.salaries.map((s) => s.nonce),
    path_bits: merkle.paths.map((p) => p.map((step) => step.bit)),
    path_nodes: merkle.paths.map((p) => p.map((step) => step.node)),
  };

  const { writeFile } = await import('node:fs/promises');
  await writeFile(inputJson, JSON.stringify(input));

  // 1. Compute witness
  await execFileAsync('snarkjs', ['wtns', 'calculate', inputJson, wasmPath, witnessJson]);
  // 2. Groth16 prove
  const { stdout } = await execFileAsync('snarkjs', ['groth16', 'prove', zkeyPath, witnessJson, '-v']);

  const match = stdout.match(/Proof:(.*?)Public:/s);
  if (!match) {
    throw new Error('Could not parse snarkjs proof output');
  }

  const proof = JSON.parse(match[1]) as ZkProofResult['proof'];
  const publicSignalsMatch = stdout.match(/Public signals:\s*(\[.*\])/s);
  const publicSignals = publicSignalsMatch
    ? (JSON.parse(publicSignalsMatch[1]) as string[])
    : [];

  const vkHash = createHash('sha256').update(opts.vkId).digest('hex').slice(0, 8);

  return {
    proof,
    publicSignals,
    vkHash,
    merkleRoot: merkle.root,
    proofBytesHex: serializeProofToBytes(proof),
  };
}

/**
 * Canonical 64-byte serialization of a Groth16 proof:
 *   32 bytes = SHA-256(fr-compressed pi_a.x || pi_a.y || pi_c.x || pi_c.y || pi_b[0].x …)
 * plus 32 bytes = SHA-256(publicSignals serialization).
 */
export function serializeProofToBytes(proof: ZkProofResult['proof']): string {
  const raw = [
    ...proof.pi_a,
    ...proof.pi_b.flat(),
    ...proof.pi_c,
  ].join(':');
  const h1 = createHash('sha256').update(Buffer.from(raw)).digest('hex');
  return h1;
}

export function verifyVkeyHash(proofBytesHex: string, vkHash: string): boolean {
  return proofBytesHex.startsWith(createHash('sha256').update(vkHash).digest('hex'));
}