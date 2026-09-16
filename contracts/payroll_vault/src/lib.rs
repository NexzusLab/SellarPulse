#![no_std]

use soroban_sdk::{
    contract, contracterror, contractimpl, contracttype, symbol_short, Address, Bytes,
    BytesN, Env, Symbol,
};

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------
const VAULT_BALANCE: Symbol = symbol_short!("BAL");
const DEPOSITS: Symbol = symbol_short!("DEP");
const PAYOUTS: Symbol = symbol_short!("PAY");
const ADMIN_KEY: Symbol = symbol_short!("ADM");
const PAUSED_KEY: Symbol = symbol_short!("PAUS");
const ZK_VERIFIER_ADDR: Symbol = symbol_short!("ZK_ADDR");
const PAYROLL_SEQ: Symbol = symbol_short!("SEQ");
const EMPLOYEE_LEDGER: Symbol = symbol_short!("EMP_L");
const USDC_ASSET: Symbol = symbol_short!("USDC");
const PYUSD_ASSET: Symbol = symbol_short!("PYUSD");
const MAX_BATCH_SIZE: usize = 100;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
#[derive(Clone)]
#[contracttype]
pub struct VaultConfig {
    pub admin: Address,
    pub token_address: Address,
    pub zk_verifier_address: Address,
    pub is_paused: bool,
    pub min_deposit: i128,
    pub max_batch_size: u32,
}

#[derive(Clone)]
#[contracttype]
pub struct PayrollBatch {
    pub batch_id: BytesN<32>,
    pub employer: Address,
    pub total_amount: i128,
    pub asset: Symbol,
    pub disbursements: soroban_sdk::Vec<Disbursement>,
    pub zk_proof_id: Option<BytesN<32>>,
    pub created_at: u64,
    pub executed: bool,
    pub failed: bool,
}

#[derive(Clone)]
#[contracttype]
pub struct Disbursement {
    pub employee: Address,
    pub amount: i128,
    pub memo: Bytes,
}

#[derive(Clone)]
#[contracttype]
pub struct PayoutRecord {
    pub batch_id: BytesN<32>,
    pub employee: Address,
    pub amount: i128,
    pub timestamp: u64,
    pub tx_hash: BytesN<32>,
}

#[derive(Clone)]
#[contracttype]
pub struct DepositRecord {
    pub depositor: Address,
    pub amount: i128,
    pub asset: Symbol,
    pub timestamp: u64,
}

#[derive(Clone)]
#[contracttype]
pub struct SolvencyProof {
    pub total_disbursed: i128,
    pub total_liability: i128,
    pub merkle_root: BytesN<32>,
    pub proof_id: BytesN<32>,
    pub verified: bool,
}

#[derive(Clone)]
#[contracttype]
pub enum VaultError {
    AlreadyInitialized = 1,
    NotInitialized = 2,
    Unauthorized = 3,
    InsufficientBalance = 4,
    ContractPaused = 5,
    InvalidBatch = 6,
    EmptyBatch = 7,
    BatchTooLarge = 8,
    DuplicateBatch = 9,
    BatchAlreadyExecuted = 10,
    ZkProofRequired = 11,
    ZkProofVerificationFailed = 12,
    InvalidToken = 13,
    InsufficientDeposit = 14,
    PayoutFailed = 15,
    SolvencyViolation = 16,
    EmployeeNotRegistered = 17,
    LedgerEntryNotFound = 18,
}

// ---------------------------------------------------------------------------
// Contract
// ---------------------------------------------------------------------------
#[contract]
pub struct PayrollVault;

#[contractimpl]
impl PayrollVault {
    // --- Initialization ---------------------------------------------------
    pub fn initialize(
        env: Env,
        admin: Address,
        token_address: Address,
        zk_verifier_address: Address,
        min_deposit: i128,
    ) -> Result<(), VaultError> {
        if env.storage().instance().has(&ADMIN_KEY) {
            return Err(VaultError::AlreadyInitialized);
        }

        let config = VaultConfig {
            admin: admin.clone(),
            token_address,
            zk_verifier_address,
            is_paused: false,
            min_deposit,
            max_batch_size: MAX_BATCH_SIZE as u32,
        };

        env.storage().instance().set(&ADMIN_KEY, &admin);
        env.storage().instance().set(&PAUSED_KEY, &false);
        env.storage().instance().set(&ZK_VERIFIER_ADDR, &zk_verifier_address);
        env.storage().instance().set(&symbol_short!("CONFIG"), &config);
        env.storage().persistent().set(&VAULT_BALANCE, &0i128);
        env.storage().persistent().set(&PAYROLL_SEQ, &0u32);
        Ok(())
    }

    // --- Internal helpers -------------------------------------------------
    fn get_admin(env: &Env) -> Result<Address, VaultError> {
        env.storage()
            .instance()
            .get(&ADMIN_KEY)
            .ok_or(VaultError::NotInitialized)
    }

    fn assert_admin(env: &Env) -> Result<(), VaultError> {
        let admin = Self::get_admin(env)?;
        admin.require_auth();
        Ok(())
    }

    fn assert_not_paused(env: &Env) -> Result<(), VaultError> {
        let paused: bool = env
            .storage()
            .instance()
            .get(&PAUSED_KEY)
            .unwrap_or(false);
        if paused {
            return Err(VaultError::ContractPaused);
        }
        Ok(())
    }

    fn get_config(env: &Env) -> Result<VaultConfig, VaultError> {
        env.storage()
            .instance()
            .get(&symbol_short!("CONFIG"))
            .ok_or(VaultError::NotInitialized)
    }

    fn next_batch_id(env: &Env) -> Result<BytesN<32>, VaultError> {
        let seq: u32 = env
            .storage()
            .persistent()
            .get(&PAYROLL_SEQ)
            .unwrap_or(0);
        let new_seq = seq.checked_add(1).ok_or(VaultError::InvalidBatch)?;

        let timestamp = env.ledger().timestamp();
        let preimage = Bytes::from_array(
            &env,
            &[
                (new_seq >> 24) as u8,
                (new_seq >> 16) as u8,
                (new_seq >> 8) as u8,
                new_seq as u8,
                (timestamp >> 56) as u8,
                (timestamp >> 48) as u8,
                (timestamp >> 40) as u8,
                (timestamp >> 32) as u8,
                (timestamp >> 24) as u8,
                (timestamp >> 16) as u8,
                (timestamp >> 8) as u8,
                timestamp as u8,
            ],
        );

        env.storage().persistent().set(&PAYROLL_SEQ, &new_seq);
        Ok(env.crypto().sha256(&preimage))
    }

    // --- Deposits ---------------------------------------------------------
    pub fn deposit(
        env: Env,
        depositor: Address,
        amount: i128,
    ) -> Result<(), VaultError> {
        depositor.require_auth();
        Self::assert_not_paused(&env)?;

        let config = Self::get_config(&env)?;
        if amount < config.min_deposit {
            return Err(VaultError::InsufficientDeposit);
        }

        let current_balance: i128 = env
            .storage()
            .persistent()
            .get(&VAULT_BALANCE)
            .unwrap_or(0);
        let new_balance = current_balance
            .checked_add(amount)
            .ok_or(VaultError::InsufficientBalance)?;

        env.storage().persistent().set(&VAULT_BALANCE, &new_balance);

        // Log the deposit
        let deposit = DepositRecord {
            depositor,
            amount,
            asset: USDC_ASSET,
            timestamp: env.ledger().timestamp(),
        };

        let dep_count: u32 = env
            .storage()
            .temporary()
            .get(&symbol_short!("DEP_CNT"))
            .unwrap_or(0);
        env.storage()
            .temporary()
            .set(&symbol_short!("DEP_CNT"), &(dep_count + 1));

        env.storage()
            .temporary()
            .set(&Symbol::short(&format!("DEP_{}", dep_count).as_bytes()), &deposit);

        Ok(())
    }

    pub fn get_balance(env: Env) -> i128 {
        env.storage()
            .persistent()
            .get(&VAULT_BALANCE)
            .unwrap_or(0)
    }

    // --- Payroll batch creation -------------------------------------------
    pub fn create_payroll_batch(
        env: Env,
        employer: Address,
        disbursements: soroban_sdk::Vec<Disbursement>,
    ) -> Result<BytesN<32>, VaultError> {
        employer.require_auth();
        Self::assert_not_paused(&env)?;

        if disbursements.is_empty() {
            return Err(VaultError::EmptyBatch);
        }
        if disbursements.len() as usize > MAX_BATCH_SIZE {
            return Err(VaultError::BatchTooLarge);
        }

        // Calculate total
        let mut total: i128 = 0;
        for d in disbursements.iter() {
            if d.amount <= 0 {
                return Err(VaultError::InvalidBatch);
            }
            total = total
                .checked_add(d.amount)
                .ok_or(VaultError::InvalidBatch)?;
        }

        // Verify vault has enough balance
        let balance: i128 = env
            .storage()
            .persistent()
            .get(&VAULT_BALANCE)
            .unwrap_or(0);
        if total > balance {
            return Err(VaultError::InsufficientBalance);
        }

        let batch_id = Self::next_batch_id(&env)?;
        let batch = PayrollBatch {
            batch_id: batch_id.clone(),
            employer,
            total_amount: total,
            asset: USDC_ASSET,
            disbursements,
            zk_proof_id: None,
            created_at: env.ledger().timestamp(),
            executed: false,
            failed: false,
        };

        env.storage()
            .persistent()
            .set(&batch_id.clone().to_buffer(), &batch);

        Ok(batch_id)
    }

    // --- ZK-linked batch creation -----------------------------------------
    pub fn create_payroll_batch_with_zk(
        env: Env,
        employer: Address,
        disbursements: soroban_sdk::Vec<Disbursement>,
        total_disbursed: i128,
        total_liability: i128,
        merkle_root: BytesN<32>,
        zk_proof_id: BytesN<32>,
    ) -> Result<BytesN<32>, VaultError> {
        employer.require_auth();
        Self::assert_not_paused(&env)?;

        // 1. Verify the ZK proof on-chain via cross-contract call
        let verifier_addr: Address = env
            .storage()
            .instance()
            .get(&ZK_VERIFIER_ADDR)
            .ok_or(VaultError::NotInitialized)?;

        // Cross-contract call to zk_verifier to validate the solvency proof
        let verify_args = soroban_sdk::Vec::from_array(
            &env,
            &[employer.clone().into(), zk_proof_id.clone().into()],
        );

        let result: bool = env
            .invoke_contract(
                &verifier_addr,
                &Symbol::new(&env, "is_proof_valid"),
                verify_args,
            )
            .try_into()
            .unwrap_or(false);

        if !result {
            return Err(VaultError::ZkProofVerificationFailed);
        }

        // 2. Verify solvency constraints
        if total_disbursed > total_liability {
            return Err(VaultError::SolvencyViolation);
        }

        // 3. Validate disbursements match total
        let mut computed_total: i128 = 0;
        for d in disbursements.iter() {
            computed_total = computed_total
                .checked_add(d.amount)
                .ok_or(VaultError::InvalidBatch)?;
        }
        if computed_total != total_disbursed {
            return Err(VaultError::SolvencyViolation);
        }

        // 4. Check vault balance
        let balance: i128 = env
            .storage()
            .persistent()
            .get(&VAULT_BALANCE)
            .unwrap_or(0);
        if total_disbursed > balance {
            return Err(VaultError::InsufficientBalance);
        }

        // 5. Create the batch with ZK proof reference
        let batch_id = Self::next_batch_id(&env)?;
        let batch = PayrollBatch {
            batch_id: batch_id.clone(),
            employer,
            total_amount: total_disbursed,
            asset: USDC_ASSET,
            disbursements,
            zk_proof_id: Some(zk_proof_id),
            created_at: env.ledger().timestamp(),
            executed: false,
            failed: false,
        };

        env.storage()
            .persistent()
            .set(&batch_id.clone().to_buffer(), &batch);

        // Emit event
        env.events().publish(
            (symbol_short!("BATCH"), batch_id.clone()),
            batch.total_amount,
        );

        Ok(batch_id)
    }

    // --- Execute batch payout ---------------------------------------------
    pub fn execute_batch(
        env: Env,
        batch_id: BytesN<32>,
    ) -> Result<soroban_sdk::Vec<PayoutRecord>, VaultError> {
        Self::assert_admin(&env)?;
        Self::assert_not_paused(&env)?;

        let key_buf = batch_id.clone().to_buffer();
        let mut batch: PayrollBatch = env
            .storage()
            .persistent()
            .get(&key_buf)
            .ok_or(VaultError::BatchAlreadyExecuted)?;

        if batch.executed {
            return Err(VaultError::BatchAlreadyExecuted);
        }
        if batch.failed {
            return Err(VaultError::InvalidBatch);
        }

        // Verify solvency at execution time
        let balance: i128 = env
            .storage()
            .persistent()
            .get(&VAULT_BALANCE)
            .unwrap_or(0);
        if batch.total_amount > balance {
            batch.failed = true;
            env.storage()
                .persistent()
                .set(&key_buf, &batch);
            return Err(VaultError::InsufficientBalance);
        }

        let mut records = soroban_sdk::Vec::new(&env);
        let now = env.ledger().timestamp();

        for disbursement in batch.disbursements.iter() {
            // Generate per-payout tx hash
            let mut tx_preimage = Bytes::new(&env);
            tx_preimage.append(&Bytes::from_array(
                &env,
                &batch_id.clone().to_buffer(),
            ));
            tx_preimage.append(&Bytes::from_array(
                &env,
                &now.to_be_bytes(),
            ));
            let tx_hash = env.crypto().sha256(&tx_preimage);

            let record = PayoutRecord {
                batch_id: batch_id.clone(),
                employee: disbursement.employee.clone(),
                amount: disbursement.amount,
                timestamp: now,
                tx_hash,
            };
            records.push_back(record);

            // Emit individual payout event for indexer
            env.events().publish(
                (symbol_short!("PAYOUT"), disbursement.employee.clone()),
                disbursement.amount,
            );
        }

        // Deduct from vault balance
        let new_balance = balance
            .checked_sub(batch.total_amount)
            .ok_or(VaultError::InsufficientBalance)?;
        env.storage().persistent().set(&VAULT_BALANCE, &new_balance);

        // Mark executed
        batch.executed = true;
        env.storage()
            .persistent()
            .set(&key_buf, &batch);

        // Emit batch-complete event
        env.events().publish(
            (symbol_short!("BATCH_OK"), batch_id),
            batch.total_amount,
        );

        Ok(records)
    }

    // --- Queries ----------------------------------------------------------
    pub fn get_batch(env: Env, batch_id: BytesN<32>) -> Result<PayrollBatch, VaultError> {
        env.storage()
            .persistent()
            .get(&batch_id.clone().to_buffer())
            .ok_or(VaultError::InvalidBatch)
    }

    pub fn get_deposit_record(
        env: Env,
        index: u32,
    ) -> Result<DepositRecord, VaultError> {
        env.storage()
            .temporary()
            .get(&Symbol::short(&format!("DEP_{}", index).as_bytes()))
            .ok_or(VaultError::LedgerEntryNotFound)
    }

    // --- Admin ------------------------------------------------------------
    pub fn pause(env: Env) -> Result<(), VaultError> {
        Self::assert_admin(&env)?;
        env.storage().instance().set(&PAUSED_KEY, &true);
        Ok(())
    }

    pub fn unpause(env: Env) -> Result<(), VaultError> {
        Self::assert_admin(&env)?;
        env.storage().instance().set(&PAUSED_KEY, &false);
        Ok(())
    }

    pub fn update_zk_verifier(
        env: Env,
        new_verifier: Address,
    ) -> Result<(), VaultError> {
        Self::assert_admin(&env)?;
        env.storage().instance().set(&ZK_VERIFIER_ADDR, &new_verifier);
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use soroban_sdk::testutils::Address as _;

    #[test]
    fn test_deposit_and_balance() {
        let env = Env::default();
        let contract_id = env.register_contract(None, PayrollVault);
        let client = PayrollVaultClient::new(&env, &contract_id);
        let admin = Address::generate(&env);
        let token = Address::generate(&env);
        let verifier = Address::generate(&env);

        env.mock_all_auths();

        client.initialize(&admin, &token, &verifier, &100);

        let depositor = Address::generate(&env);
        client.deposit(&depositor, &50_000);

        let balance = client.get_balance();
        assert_eq!(balance, 50_000);
    }

    #[test]
    fn test_create_and_execute_batch() {
        let env = Env::default();
        let contract_id = env.register_contract(None, PayrollVault);
        let client = PayrollVaultClient::new(&env, &contract_id);
        let admin = Address::generate(&env);
        let token = Address::generate(&env);
        let verifier = Address::generate(&env);

        env.mock_all_auths();

        client.initialize(&admin, &token, &verifier, &100);
        client.deposit(&admin, &100_000);

        let emp1 = Address::generate(&env);
        let emp2 = Address::generate(&env);

        let disbursements = soroban_sdk::Vec::from_array(
            &env,
            &[
                Disbursement {
                    employee: emp1.clone(),
                    amount: 5_000,
                    memo: Bytes::from_array(&env, b"salary"),
                },
                Disbursement {
                    employee: emp2.clone(),
                    amount: 7_500,
                    memo: Bytes::from_array(&env, b"salary"),
                },
            ],
        );

        let batch_id = client.create_payroll_batch(&admin, &disbursements);
        let batch = client.get_batch(&batch_id);
        assert_eq!(batch.total_amount, 12_500);
        assert!(!batch.executed);

        let records = client.execute_batch(&batch_id);
        assert_eq!(records.len(), 2);

        let balance = client.get_balance();
        assert_eq!(balance, 87_500);
    }
}
