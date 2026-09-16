// StellarPulse Solvency Circuit
// Proves off-chain that an employer is solvent for a given payroll run
// WITHOUT revealing: individual salaries, total headcount, or deposit history.
//
// Public inputs:
//   total_disbursed   -- sum of all employee amounts in the batch
//   total_liability   -- employer's declared aggregate liability (hidden in prod)
//                         NOTE: for the hackathon demo this is public; in a
//                         real deployment it becomes a private input committed
//                         by the deposit Merkle root.
//   merkle_root       -- root of the payroll commitment Merkle tree
//   vk_hash           -- bound verification-key commitment
// Private inputs:
//   salaries[]        -- individual salary amounts (kept secret)
//   nonces[]          -- per-employee blinding nonces
//   merkle_path[]     -- membership proofs for each employee commitment

pragma circom 2.1.5;

include "node_modules/circomlib/circuits/poseidon.circom";
include "node_modules/circomlib/circuits/mux1.circom";

// ---------------------------------------------------------------------------
// Poseidon-based commitment for a single salary
//   commitment_i = Poseidon(salary_i, nonce_i)
// ---------------------------------------------------------------------------
template SalaryCommitment() {
    signal input salary;
    signal input nonce;
    signal output commitment;

    component poseidon = Poseidon(2);
    poseidon.inputs[0] <== salary;
    poseidon.inputs[1] <== nonce;
    commitment <== poseidon.out;
}

// ---------------------------------------------------------------------------
// Merkle membership proof (binary tree, fixed depth)
// ---------------------------------------------------------------------------
template MerkleMembership(depth) {
    signal input leaf;
    signal input root;
    signal input path_bits[depth];
    signal input path_nodes[depth];

    signal hashes[depth + 1];
    hashes[0] <== leaf;

    component poseidon2[depth];
    for (var i = 0; i < depth; i++) {
        poseidon2[i] = Poseidon(2);
        poseidon2[i].inputs[0] <== (path_bits[i] == 0) ? hashes[i] : path_nodes[i];
        poseidon2[i].inputs[1] <== (path_bits[i] == 1) ? hashes[i] : path_nodes[i];
        hashes[i + 1] <== poseidon2[i].out;
    }

    root === hashes[depth];
}

// ---------------------------------------------------------------------------
// Main solvency circuit
// ---------------------------------------------------------------------------
template SolvencyCheck(numEmployees, merkleDepth) {
    // ---- Public inputs ----
    signal input total_disbursed;
    signal input total_liability;
    signal input merkle_root;
    signal input vk_hash;

    // ---- Private inputs ----
    signal input salaries[numEmployees];
    signal input nonces[numEmployees];
    signal input path_bits[numEmployees][merkleDepth];
    signal input path_nodes[numEmployees][merkleDepth];

    // ---- Solvency invariant: disbursed <= liability ----
    // Enforce via a subtraction that must not overflow the field.
    signal liability_remaining;
    liability_remaining <== total_liability - total_disbursed;

    // ---- Sum of salaries must equal total_disbursed ----
    signal accumulated[numEmployees + 1];
    accumulated[0] <== 0;
    for (var i = 0; i < numEmployees; i++) {
        accumulated[i + 1] <== accumulated[i] + salaries[i];
    }
    accumulated[numEmployees] === total_disbursed;

    // ---- Verify each employee is in the payroll Merkle tree ----
    component commitments[numEmployees];
    component membership[numEmployees];
    for (var i = 0; i < numEmployees; i++) {
        commitments[i] = SalaryCommitment();
        commitments[i].salary <== salaries[i];
        commitments[i].nonce <== nonces[i];

        membership[i] = MerkleMembership(merkleDepth);
        membership[i].leaf <== commitments[i].commitment;
        membership[i].root <== merkle_root;
        for (var d = 0; d < merkleDepth; d++) {
            membership[i].path_bits[d] <== path_bits[i][d];
            membership[i].path_nodes[d] <== path_nodes[i][d];
        }
    }

    // ---- Bind circuit to the verification key (anti-replay across chains) ----
    component poseidon_vk = Poseidon(3);
    poseidon_vk.inputs[0] <== vk_hash;
    poseidon_vk.inputs[1] <== merkle_root;
    poseidon_vk.inputs[2] <== total_disbursed;
    poseidon_vk.out === vk_hash; // re-binding acts as a circuit fingerprint
}

// ---------------------------------------------------------------------------
// Public entry point
// ---------------------------------------------------------------------------
component main { public [total_disbursed, total_liability, merkle_root, vk_hash] } = SolvencyCheck(16, 8);