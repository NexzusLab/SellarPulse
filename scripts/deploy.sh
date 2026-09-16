#!/usr/bin/env bash
# StellarPulse full pipeline: circuit setup -> contract deploy -> backend seed.
# Requires: soroban-cli, rust/cargo, snarkjs, node >= 18.
set -euo pipefail

# ---------------------------------------------------------------- config
NETWORK="${NETWORK:-testnet}"
RPC_URL="${RPC_URL:-https://soroban-testnet.stellar.org}"
NETWORK_PASSPHRASE="${NETWORK_PASSPHRASE:-Test SDF Network ; September 2015}"
FUNDER_SECRET="${FUNDER_SECRET:?set FUNDER_SECRET to a funded testnet account}"

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ARTIFACTS=".artifacts"
mkdir -p "$ARTIFACTS"

# ---------------------------------------------------------------- 1. circuits
echo "==> 1/4 Generating ZK circuit artifacts"
cd "$ROOT/circuits"
if [[ ! -f solvency_final.zkey ]]; then
  snarkjs powersoftau new bn128 15 pot15_0000.ptau -v
  snarkjs powersoftau contribute pot15_0000.ptau pot15_0001.ptau --name="StellarPulse" -v
  snarkjs powersoftau prepare phase2 pot15_0001.ptau pot15_final.ptau -v
  circom solvency.circom --r1cs --wasm --sym
  snarkjs groth16 setup solvency.r1cs pot15_final.ptau solvency_0000.zkey
  snarkjs zkey contribute solvency_0000.zkey solvency_final.zkey --name="StellarPulse 2" -v
  snarkjs zkey export verificationkey solvency_final.zkey solvency_verification_key.json
fi
cp -r solvency_js solvency_final.zkey solvency_verification_key.json "$ROOT/$ARTIFACTS/"

# ---------------------------------------------------------------- 2. contracts
echo "==> 2/4 Compiling Soroban contracts (release)"
cd "$ROOT/contracts"
cargo build --release --target wasm32-unknown-unknown
cp target/wasm32-unknown-unknown/release/zk_verifier.wasm   "$ROOT/$ARTIFACTS/"
cp target/wasm32-unknown-unknown/release/payroll_vault.wasm "$ROOT/$ARTIFACTS/"

# ---------------------------------------------------------------- 3. superuser
echo "==> 3/4 Creating/funding superuser ($FUNDER_ADMIN) and relay"
FUNDER_PUBLIC_KEY="$(soroban keys address --secret "$FUNDER_SECRET")"
FUNDER_ADMIN="${FUNDER_ADMIN:-$(soroban keys generate --fund stellarpulse_admin 2>/dev/null || echo "")}"
if [[ -z "$FUNDER_ADMIN" ]]; then
  FUNDER_ADMIN="$(soroban keys address stellarpulse_admin)"
fi

# ---------------------------------------------------------------- 4. deploy
echo "==> 4/4 Deploying zk_verifier + payroll_vault"
soroban contract deploy \
  --wasm "$ROOT/$ARTIFACTS/zk_verifier.wasm" \
  --source stellarpulse_admin \
  --network "$NETWORK" \
  --rpc-url "$RPC_URL" \
  --network-passphrase "$NETWORK_PASSPHRASE" \
> "$ROOT/$ARTIFACTS/zk_verifier.id"

soroban contract deploy \
  --wasm "$ROOT/$ARTIFACTS/payroll_vault.wasm" \
  --source stellarpulse_admin \
  --network "$NETWORK" \
  --rpc-url "$RPC_URL" \
  --network-passphrase "$NETWORK_PASSPHRASE" \
> "$ROOT/$ARTIFACTS/payroll_vault.id"

echo ""
echo "────────────────────────────────────────────────────────────"
echo "  zk_verifier : $(cat "$ROOT/$ARTIFACTS/zk_verifier.id")"
echo "  payroll_vault: $(cat "$ROOT/$ARTIFACTS/payroll_vault.id")"
echo "────────────────────────────────────────────────────────────"
echo "Next: cp backend/.env.example backend/.env and set contract ids."