# StellarPulse — Decentralized Cross-Border Payroll & ZK-Compliance Rail

StellarPulse runs cross-border payroll on Stellar's USDC rails, backed by
off-chain **Groth16 zero-knowledge proofs** that every batch is fully funded
(solvency) — while keeping individual salaries, headcount, and deposit history
private. Smart contracts live on **Soroban** (Rust); a Node indexer watches
contract events; a React dashboard drives employer and employee flows.

```
┌──────────────────┐   upload CSV   ┌───────────────────────┐
│ React frontend   │ ─────────────► │ Express.js API         │
│ Employer portal  │                │ • /api/payroll/batch   │
│ Employee dash.   │ ◄───────────── │ • /api/proof/generate  │
└──────────────────┘    polls       │ • Soroban event idxr   │
        │   │                        └──────────┬────────────┘
        │   │  Freighter / Wallets Kit           │ worker (BullMQ/Redis)
        ▼   ▼                                   ▼
┌─────────────────────────────────────────────────────────────┐
│                         Stellar Testnet                      │
│  payroll_vault  ⇄  zk_verifier  (Soroban contracts, Rust)   │
│  USDC/PYUSD deposits · batch disbursements · ZK solvency     │
└─────────────────────────────────────────────────────────────┘
```

## Monorepo layout

```
├── contracts/
│   ├── zk_verifier/        Soroban contract — proof verification, VK registry
│   └── payroll_vault/      Soroban contract — deposits, batches, executors
├── circuits/
│   └── solvency.circom     ZK circuit (Poseidon Merkle + salary commitments)
├── backend/                Express.js API, Prisma + PostgreSQL, BullMQ + Redis
├── frontend/               React + Vite + TS + Tailwind, Freighter/Wallets Kit
├── scripts/                deploy.sh · build.sh
└── docs/                   architecture + CLI deep-dive
```

## Quick start

### 0. Prerequisites
- Rust `1.75+` with `wasm32-unknown-unknown` target: `rustup target add wasm32-unknown-unknown`
- [Soroban CLI](https://soroban.stellar.org/docs/getting-started/setup) v21 (`cargo install --locked soroban-cli`)
- Node `>= 18`, PostgreSQL, Redis
- Optional: `snarkjs` + `circomlibjs` for proofs

### 1. Install & build
```bash
./scripts/build.sh          # contracts (cargo), backend (npm ci + prisma), frontend (npm ci)
```

### 2. Compile the contracts to WASM

```bash
cd contracts
cargo build --release --target wasm32-unknown-unknown

ls target/wasm32-unknown-unknown/release/
#   payroll_vault.wasm   zk_verifier.wasm
```

### 3. Deploy to Testnet

```bash
# Fund one admin wallet (one-time)
export FUNDER_SECRET=S...           # testnet secret key
soroban keys generate --fund stellarpulse_admin   # or reuse FUNDER_SECRET

cd contracts

# Deploy ZK verifier
soroban contract deploy \
  --wasm target/wasm32-unknown-unknown/release/zk_verifier.wasm \
  --source stellarpulse_admin \
  --network testnet \
  --rpc-url https://soroban-testnet.stellar.org \
  --network-passphrase "Test SDF Network ; September 2015"
# → C...ZK_VERIFIER_ADDR

# Deploy payroll vault
soroban contract deploy \
  --wasm target/wasm32-unknown-unknown/release/payroll_vault.wasm \
  --source stellarpulse_admin \
  --network testnet \
  --rpc-url https://soroban-testnet.stellar.org \
  --network-passphrase "Test SDF Network ; September 2015"
# → C...PAYROLL_VAULT_ADDR
```

### 4. Initialize the contracts

```bash
# zk_verifier: set admin
soroban contract invoke \
  --id <ZK_VERIFIER_ADDR> \
  --source stellarpulse_admin \
  --network testnet \
  -- initialize \
  --admin <ADMIN_PUBLIC_KEY>

# payroll_vault: set admin, USDC token, verifier, min deposit
soroban contract invoke \
  --id <PAYROLL_VAULT_ADDR> \
  --source stellarpulse_admin \
  --network testnet \
  -- initialize \
  --admin <ADMIN_PUBLIC_KEY> \
  --token_address <USDC_CONTRACT_ID> \
  --zk_verifier_address <ZK_VERIFIER_ADDR> \
  --min_deposit 1000000      # 1 USDC (7 decimals)
```

### 5. Register a ZK verification key

```bash
soroban contract invoke \
  --id <ZK_VERIFIER_ADDR> \
  --source stellarpulse_admin \
  --network testnet \
  -- register_verification_key \
  --vk_hash 0000...deadbeef  \
  --circuit_id 1 \
  --ttl 86400
# → VK_ID (BytesN<32>)
```

### 6. Deposit + create a payroll batch (with ZK solvency proof)

```bash
# Deposit funds into the vault
soroban contract invoke \
  --id <PAYROLL_VAULT_ADDR> \
  --source stellarpulse_admin \
  --network testnet \
  -- deposit \
  --depositor <ADMIN_PUBLIC_KEY> \
  --amount 5000000000         # 500 USDC

# Build the batch (JSON args)
cat > batch.json <<'JSON'
[
  { "employee": "G...EMP1", "amount": 250000000, "memo": "salary" },
  { "employee": "G...EMP2", "amount": 125000000, "memo": "salary" }
]
JSON

soroban contract invoke \
  --id <PAYROLL_VAULT_ADDR> \
  --source stellarpulse_admin \
  --network testnet \
  -- create_payroll_batch \
  --employer <ADMIN_PUBLIC_KEY> \
  --disbursements "$(cat batch.json)" \
  --total_disbursed 375000000 \
  --total_liability 375000000 \
  --merkle_root <MERKLE_ROOT_FROM_PROVER> \
  --zk_proof_id <PROOF_ID>
```

### 7. Execute the batch

```bash
read BATCH_ID   # returned by create_payroll_batch

soroban contract invoke \
  --id <PAYROLL_VAULT_ADDR> \
  --source stellarpulse_admin \
  --network testnet \
  -- execute_batch \
  --batch_id "$BATCH_ID"
```

### 8. Query state

```bash
soroban contract invoke \
  --id <PAYROLL_VAULT_ADDR> \
  --network testnet \
  -- get_balance

soroban contract invoke \
  --id <PAYROLL_VAULT_ADDR> \
  --network testnet \
  -- get_batch --batch_id "$BATCH_ID"

soroban contract invoke \
  --id <ZK_VERIFIER_ADDR> \
  --network testnet \
  -- is_proof_valid --proof_id <PROOF_ID>
```

## Tests

```bash
cd contracts && cargo test                    # contract unit tests
cd backend   && npm test                      # API tests
```

## ZK proof pipeline (off-chain)

```bash
cd circuits
snarkjs powersoftau new bn128 15 pot15_0000.ptau -v
snarkjs powersoftau contribute pot15_0000.ptau pot15_0001.ptau --name=sp -v
snarkjs powersoftau prepare phase2 pot15_0001.ptau pot15_final.ptau -v
circom solvency.circom --r1cs --wasm --sym
snarkjs groth16 setup solvency.r1cs pot15_final.ptau solvency_0000.zkey
snarkjs zkey contribute solvency_0000.zkey solvency_final.zkey --name=sp2 -v
snarkjs zkey export verificationkey solvency_final.zkey solvency_verification_key.json

# Prove (or delegate to POST /api/proof/generate)
snarkjs groth16 fullprove input.json solvency_js/solvency.wasm solvency_final.zkey proof.json public.json
snarkjs groth16 verify solvency_verification_key.json public.json proof.json
```

## API endpoints

| Method | Path                       | Purpose                                     |
|--------|----------------------------|---------------------------------------------|
| POST   | `/api/payroll/batch`       | Create + queue an on-chain payroll batch    |
| POST   | `/api/payroll/queue`       | Schedule payout job (idempotent)            |
| GET    | `/api/payroll/status/:id`  | Batch status + queue position               |
| POST   | `/api/proof/generate`      | Run off-chain Groth16 prover                |
| GET    | `/api/proof/:proofId`      | Proof verification status                   |
| GET    | `/health`                  | Liveness check                              |

All `/api/*` routes authenticate via `x-api-key` and are rate-limited.

## Indexer

```bash
cd backend
npm run indexer     # polls Soroban RPC events, persists to PostgreSQL
```

Watches `PAYOUT`, `BATCH`, `BATCH_OK`, `DEPOSIT` topics from the payroll vault.

## Disclaimer
Hackathon reference implementation. The on-chain "Groth16 verification" uses a
SHA-256 commitment binding (proof ‖ inputs ‖ vk-hash) in place of full pairing
checks; swap in a real BN254 verifier before any mainnet use.