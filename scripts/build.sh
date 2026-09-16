#!/usr/bin/env bash
# Builds all three workspaces after a fresh clone.
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

echo "==> contracts"
cd "$ROOT/contracts"
cargo build --release --target wasm32-unknown-unknown

echo "==> backend"
cd "$ROOT/backend"
npm ci
npx prisma generate

echo "==> frontend"
cd "$ROOT/frontend"
npm ci

echo "==> circuits (only if snarkjs available)"
cd "$ROOT/circuits"
if command -v snarkjs >/dev/null 2>&1; then
  npm init -y >/dev/null 2>&1
  npm i --no-save circomlibjs snarkjs
fi

echo "Build complete."
cat <<'EOF'

Now run:
  export FUNDER_SECRET=<secret>
  ./scripts/deploy.sh
EOF