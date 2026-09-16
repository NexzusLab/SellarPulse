import 'dotenv/config';

function required(name: string, fallback?: string): string {
  const value = process.env[name] ?? fallback;
  if (value === undefined) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

export const config = {
  nodeEnv: required('nodeEnv', 'development'),
  port: Number(required('PORT', '4000')),
  host: required('HOST', '0.0.0.0'),

  stellar: {
    networkPassphrase: required(
      'NETWORK_PASSPHRASE',
      'Test SDF Network ; September 2015',
    ),
    rpcUrl: required(
      'STELLAR_RPC_URL',
      'https://soroban-testnet.stellar.org',
    ),
    friendbotUrl: required('FRIENDBOT_URL', 'https://friendbot.stellar.org'),
  },

  contracts: {
    payrollVault: required('PAYROLL_VAULT_CONTRACT'),
    zkVerifier: required('ZK_VERIFIER_CONTRACT'),
    usdc: required('USDC_CONTRACT'),
  },

  relay: {
    secret: required('RELAY_SECRET'),
    publicKey: required('RELAY_PUBLIC'),
  },

  database: {
    url: required('DATABASE_URL', 'postgresql://postgres:postgres@localhost:5432/stellarpulse'),
  },

  redis: {
    url: required('REDIS_URL', 'redis://localhost:6379'),
  },

  auth: {
    apiKeys: required('API_KEYS', 'dev_public_key_do_not_use_in_prod')
      .split(',')
      .map((k) => k.trim()),
    header: required('API_KEY_HEADER', 'x-api-key'),
  },

  rateLimit: {
    windowMs: Number(required('RATE_LIMIT_WINDOW_MS', '60000')),
    max: Number(required('RATE_LIMIT_MAX', '60')),
  },

  zk: {
    proofDir: required('ZK_PROOF_DIR', '../circuits'),
    wasmPath: required('ZK_WASM', 'zkey-gen/solvency_js/solvency.wasm'),
    zkeyPath: required('ZK_ZKEY', 'solvency_final.zkey'),
    vkeyPath: required('ZK_VKEY', 'solvency_verification_key.json'),
  },
} as const;

export type AppConfig = typeof config;