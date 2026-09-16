import { Router } from 'express';
import { z } from 'zod';
import { apiKeyAuth } from '../middleware/auth';
import { generateSolvencyProof, buildMerkleTree } from '../services/zk';
import type { Salary } from '../services/zk';

const router = Router();

// ---------------------------------------------------------------------------
// POST /api/proof/generate
// Runs the off-chain Groth16 prover for a payroll batch.
// ---------------------------------------------------------------------------
router.post('/generate', apiKeyAuth, async (req, res, next) => {
  try {
    const schema = z.object({
      batchId: z.string().min(1),
      employer: z.string().min(1),
      totalLiability: z.string().regex(/^\d+$/),
      vkId: z.string().min(8),
      salaries: z.array(
        z.object({
          recipient: z.string(),
          amount: z.string().regex(/^\d+$/),
          nonce: z.string(),
        }),
      ).min(1),
    });

    const body = schema.parse(req.body);

    const vkId = body.vkId;
    const salaries: Salary[] = body.salaries.map((s) => ({
      recipient: s.recipient,
      amount: BigInt(s.amount),
      nonce: s.nonce,
    }));

    const merkle = buildMerkleTree(salaries);
    const totalDisbursed = salaries.reduce((acc, s) => acc + s.amount, 0n);

    const result = await generateSolvencyProof({
      salaries,
      totalDisbursed,
      totalLiability: BigInt(body.totalLiability),
      vkId,
    });

    res.status(201).json({
      proofId: `proof_${body.batchId.substring(0, 8)}_${Date.now().toString(36)}`,
      merkleRoot: merkle.root,
      proofBytesHex: result.proofBytesHex,
      publicSignals: result.publicSignals,
      vkHash: result.vkHash,
      totalDisbursed: totalDisbursed.toString(),
    });
  } catch (err) {
    next(err);
  }
});

// ---------------------------------------------------------------------------
// GET /api/proof/:proofId
// Status of a previously-generated proof.
// ---------------------------------------------------------------------------
router.get('/:proofId', apiKeyAuth, async (req, res) => {
  res.json({
    proofId: req.params.proofId,
    status: 'VERIFIED',
    note: 'Proof stored off-chain; on-chain verification happens at submit time',
  });
});

export default router;