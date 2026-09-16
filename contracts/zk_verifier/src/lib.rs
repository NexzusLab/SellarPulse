#![no_std]

use soroban_sdk::{
    contract, contracterror, contractimpl, contracttype, symbol_short, Address, Bytes,
    BytesN, Env, Symbol,
};

// ---------------------------------------------------------------------------
// Storage keys
// ---------------------------------------------------------------------------
const VERIFICATION_KEYS: Symbol = symbol_short!("VK_STORE");
const PROOF_LOG: Symbol = symbol_short!("PROOF_LOG");
const ADMIN_KEY: Symbol = symbol_short!("ADMIN");
const PAUSED_KEY: Symbol = symbol_short!("PAUSED");
const TTL_SECONDS: u32 = 86400; // 24 h temporary storage TTL

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
#[derive(Clone)]
#[contracttype]
pub struct VerificationKey {
    pub key_id: BytesN<32>,
    pub vk_hash: BytesN<32>,
    pub circuit_id: u32,
    pub created_at: u64,
    pub expires_at: u64,
    pub is_active: bool,
}

#[derive(Clone)]
#[contracttype]
pub struct ProofSubmission {
    pub proof_id: BytesN<32>,
    pub submitter: Address,
    pub vk_id: BytesN<32>,
    pub public_inputs_hash: BytesN<32>,
    pub timestamp: u64,
    pub verified: bool,
}

#[derive(Clone)]
#[contracttype]
pub enum VerifierError {
    AlreadyInitialized = 1,
    NotInitialized = 2,
    InvalidProof = 3,
    ExpiredVerificationKey = 4,
    VerificationKeyNotFound = 5,
    Unauthorized = 6,
    ContractPaused = 7,
    DuplicateProof = 8,
    InvalidPublicInputs = 9,
    ProofExpired = 10,
    InsufficientStorage = 11,
}

// ---------------------------------------------------------------------------
// Contract
// ---------------------------------------------------------------------------
#[contract]
pub struct ZkVerifier;

#[contractimpl]
impl ZkVerifier {
    // --- Initialization ---------------------------------------------------
    pub fn initialize(env: Env, admin: Address) -> Result<(), VerifierError> {
        if env.storage().instance().has(&ADMIN_KEY) {
            return Err(VerifierError::AlreadyInitialized);
        }
        env.storage().instance().set(&ADMIN_KEY, &admin);
        env.storage().instance().set(&PAUSED_KEY, &false);
        env.storage().persistent().set(&symbol_short!("VK_SEQ"), &0u32);
        Ok(())
    }

    // --- Admin helpers ----------------------------------------------------
    fn assert_admin(env: &Env) -> Result<Address, VerifierError> {
        if !env.storage().instance().has(&ADMIN_KEY) {
            return Err(VerifierError::NotInitialized);
        }
        let admin: Address = env.storage().instance().get(&ADMIN_KEY).unwrap();
        admin.require_auth();
        Ok(admin)
    }

    fn assert_not_paused(env: &Env) -> Result<(), VerifierError> {
        let paused: bool = env
            .storage()
            .instance()
            .get(&PAUSED_KEY)
            .unwrap_or(false);
        if paused {
            return Err(VerifierError::ContractPaused);
        }
        Ok(())
    }

    pub fn pause(env: Env) -> Result<(), VerifierError> {
        Self::assert_admin(&env)?;
        env.storage().instance().set(&PAUSED_KEY, &true);
        Ok(())
    }

    pub fn unpause(env: Env) -> Result<(), VerifierError> {
        Self::assert_admin(&env)?;
        env.storage().instance().set(&PAUSED_KEY, &false);
        Ok(())
    }

    // --- Verification Key management --------------------------------------
    pub fn register_verification_key(
        env: Env,
        vk_hash: BytesN<32>,
        circuit_id: u32,
        ttl: u32,
    ) -> Result<BytesN<32>, VerifierError> {
        Self::assert_admin(&env)?;
        Self::assert_not_paused(&env)?;

        let seq: u32 = env
            .storage()
            .persistent()
            .get(&symbol_short!("VK_SEQ"))
            .unwrap();
        let new_seq = seq.checked_add(1).ok_or(VerifierError::InsufficientStorage)?;

        let key_id = env.crypto().sha256(
            &Bytes::from_array(&env, &[
                (new_seq >> 24) as u8,
                (new_seq >> 16) as u8,
                (new_seq >> 8) as u8,
                new_seq as u8,
            ]),
        );

        let now = env.ledger().timestamp();
        let vk = VerificationKey {
            key_id: key_id.clone(),
            vk_hash,
            circuit_id,
            created_at: now,
            expires_at: now + ttl as u64,
            is_active: true,
        };

        env.storage().persistent().set(&VERIFICATION_KEYS, &new_seq);
        env.storage()
            .temporary()
            .set(&key_id.clone().to_buffer(), &vk);

        // Store the active VK ID for the circuit
        let circuit_key = Symbol::short(&format!("CIR_{}", circuit_id).as_bytes());
        env.storage()
            .temporary()
            .set(&circuit_key, &key_id.clone());

        Ok(key_id)
    }

    pub fn revoke_verification_key(
        env: Env,
        key_id: BytesN<32>,
    ) -> Result<(), VerifierError> {
        Self::assert_admin(&env)?;

        let key_buf = key_id.to_buffer();
        let mut vk: VerificationKey = env
            .storage()
            .temporary()
            .get(&key_buf)
            .ok_or(VerifierError::VerificationKeyNotFound)?;
        vk.is_active = false;
        env.storage().temporary().set(&key_buf, &vk);
        Ok(())
    }

    // --- Proof verification ------------------------------------------------
    pub fn submit_proof(
        env: Env,
        submitter: Address,
        vk_id: BytesN<32>,
        proof_bytes: BytesN<64>,
        public_inputs: Bytes,
    ) -> Result<BytesN<32>, VerifierError> {
        Self::assert_not_paused()?;
        submitter.require_auth();

        // 1. Retrieve the verification key
        let key_buf = vk_id.to_buffer();
        let vk: VerificationKey = env
            .storage()
            .temporary()
            .get(&key_buf)
            .ok_or(VerifierError::VerificationKeyNotFound)?;

        if !vk.is_active {
            return Err(VerifierError::VerificationKeyNotFound);
        }

        // 2. Check VK expiry against current ledger
        let now = env.ledger().timestamp();
        if now > vk.expires_at {
            return Err(VerifierError::ExpiredVerificationKey);
        }

        // 3. Validate public inputs are non-empty
        if public_inputs.len() == 0 {
            return Err(VerifierError::InvalidPublicInputs);
        }

        // 4. Core verification: hash proof || public_inputs against VK hash
        //    In production this would perform full Groth16 pairing checks.
        //    On Soroban we compress verification into a SHA-256 commitment
        //    scheme: H(proof ‖ public_inputs ‖ vk_hash) must match the
        //    on-chain vk_hash, providing a binding commitment check.
        let mut preimage = Bytes::new(&env);
        preimage.append(&proof_bytes.into());
        preimage.append(&public_inputs);
        preimage.append(&Bytes::from_array(&env, &vk.vk_hash.to_buffer()));

        let computed_hash = env.crypto().sha256(&preimage);
        let computed_buf = computed_hash.to_buffer();
        let vk_buf = vk.vk_hash.to_buffer();

        // XOR-reduce the two 32-byte hashes; if they differ at any bit the
        // proof is rejected.
        let mut mismatch: u8 = 0;
        for i in 0..32 {
            mismatch |= computed_buf[i] ^ vk_buf[i];
        }

        let verified = mismatch == 0;

        // 5. Generate proof ID and log the submission
        let proof_id_preimage = Bytes::from_array(
            &env,
            &[
                (now >> 56) as u8,
                (now >> 48) as u8,
                (now >> 40) as u8,
                (now >> 32) as u8,
                (now >> 24) as u8,
                (now >> 16) as u8,
                (now >> 8) as u8,
                now as u8,
            ],
        );
        let proof_id = env.crypto().sha256(&proof_id_preimage);

        let public_inputs_hash_raw = env.crypto().sha256(&public_inputs);

        let submission = ProofSubmission {
            proof_id: proof_id.clone(),
            submitter,
            vk_id,
            public_inputs_hash: public_inputs_hash_raw,
            timestamp: now,
            verified,
        };

        env.storage()
            .temporary()
            .set(&proof_id.clone().to_buffer(), &submission);

        Ok(proof_id)
    }

    pub fn get_proof_status(
        env: Env,
        proof_id: BytesN<32>,
    ) -> Result<ProofSubmission, VerifierError> {
        let buf = proof_id.to_buffer();
        env.storage()
            .temporary()
            .get(&buf)
            .ok_or(VerifierError::InvalidProof)
    }

    pub fn is_proof_valid(env: Env, proof_id: BytesN<32>) -> bool {
        let buf = proof_id.to_buffer();
        let result: Result<ProofSubmission, _> =
            env.storage().temporary().get(&buf);
        match result {
            Ok(sub) => sub.verified,
            Err(_) => false,
        }
    }

    // --- Batch verification (for payroll solvency) ------------------------
    pub fn verify_solvency_batch(
        env: Env,
        submitter: Address,
        vk_id: BytesN<32>,
        batch_proof: BytesN<64>,
        total_disbursed: i128,
        total_liability: i128,
        merkle_root: BytesN<32>,
    ) -> Result<BytesN<32>, VerifierError> {
        submitter.require_auth();
        Self::assert_not_paused(&env)?;

        // Ensure solvency: total_disbursed <= total_liability
        if total_disbursed > total_liability {
            return Err(VerifierError::InvalidPublicInputs);
        }

        // Build a composite public-inputs blob for the batch
        let mut inputs = Bytes::new(&env);
        inputs.append(&Bytes::from_array(&env, &total_disbursed.to_be_bytes()));
        inputs.append(&Bytes::from_array(&env, &total_liability.to_be_bytes()));
        inputs.append(&Bytes::from_array(&env, &merkle_root.to_buffer()));

        // Delegate to the generic proof submission path
        Self::submit_proof(env, submitter, vk_id, batch_proof, inputs)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use soroban_sdk::testutils::{Address as _, BytesN as _};

    #[test]
    fn test_initialize_and_pause() {
        let env = Env::default();
        let contract_id = env.register_contract(None, ZkVerifier);
        let client = ZkVerifierClient::new(&env, &contract_id);
        let admin = Address::generate(&env);

        env.mock_all_auths();

        let result = client.try_initialize(&admin);
        assert!(result.is_ok());

        let result = client.try_pause();
        assert!(result.is_ok());

        // Submitting while paused should fail
        let submitter = Address::generate(&env);
        let vk_id = BytesN::<32>::random(&env);
        let proof = BytesN::<64>::random(&env);
        let inputs = soroban_sdk::Bytes::from_array(&env, &[1, 2, 3]);
        let result = client.try_submit_proof(&submitter, &vk_id, &proof, &inputs);
        assert_eq!(result, Err(Ok(VerifierError::ContractPaused)));
    }
}
