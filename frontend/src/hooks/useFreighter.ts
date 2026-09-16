import { useState, useCallback, useEffect, useRef } from 'react';
import type { WalletContext } from '../types';

/**
 * Hook that wraps Stellar Freighter (or Stellar Wallets Kit) to provide a
 * unified wallet-context to the rest of the application.
 *
 * During the hackathon we try Freighter first; when it's unavailable (e.g.
 * running on a mobile device without the extension) the user is still able to
 * paste a secret key for signing. The secret is kept only in React state — it
 * is never persisted to localStorage or sent anywhere.
 */
export function useFreighter(): WalletContext {
  const [address, setAddress] = useState<string | null>(null);
  const [network, setNetwork] = useState('testnet');
  const secretRef = useRef<string | null>(null);

  const connect = useCallback(async () => {
    try {
      // Dynamic import so the app builds even when Freighter isn't installed.
      const freighter = await import('@stellar/freighter-api');
      const [addr, net] = await Promise.all([
        freighter.getAddress(),
        freighter.getNetwork(),
      ]);
      setAddress(addr);
      setNetwork(net.includes('PUBLIC') ? 'mainnet' : 'testnet');
    } catch {
      // Freighter not available — fall back to secret-key input mode.
      const secret = prompt(
        'Freighter extension not detected.\nPaste your testnet secret key to continue (it stays in-memory only):',
      );
      if (secret) {
        // Derive address from secret client-side via Stellar SDK.
        const sdk = await import('@stellar/stellar-sdk');
        const kp = sdk.Keypair.fromSecret(secret);
        secretRef.current = secret;
        setAddress(kp.publicKey());
        setNetwork('testnet');
      }
    }
  }, []);

  const disconnect = useCallback(() => {
    setAddress(null);
    secretRef.current = null;
  }, []);

  const signTransaction = useCallback(
    async (xdr: string): Promise<string> => {
      try {
        const freighter = await import('@stellar/freighter-api');
        return await freighter.signTransaction(xdr);
      } catch {
        // Secret-key fallback
        if (!secretRef.current) throw new Error('Not connected');
        const sdk = await import('@stellar/stellar-sdk');
        const txn = sdk.TransactionBuilder.fromXDR(
          xdr,
          sdk.Networks.TESTNET,
        );
        txn.sign(sdk.Keypair.fromSecret(secretRef.current));
        return txn.toXDR();
      }
    },
    [],
  );

  // Auto-connect on mount if Freighter is injected.
  useEffect(() => {
    if (typeof window !== 'undefined' && window.freighter) {
      connect().catch(() => {});
    }
  }, [connect]);

  return { address, isConnected: !!address, connect, disconnect, signTransaction, network };
}