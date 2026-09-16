import React from 'react';
import { useFreighter } from '../hooks/useFreighter';

export default function WalletConnect() {
  const { address, isConnected, connect, disconnect, network } = useFreighter();

  return (
    <div className="flex items-center gap-3">
      {isConnected ? (
        <>
          <span className="inline-block h-2 w-2 rounded-full bg-emerald-400 animate-pulse" />
          <span className="font-mono text-xs text-stellar-700 truncate max-w-[180px]">
            {address}
          </span>
          <span className="text-[10px] uppercase font-semibold text-stellar-500 bg-stellar-50 px-2 py-0.5 rounded-full">
            {network}
          </span>
          <button
            onClick={disconnect}
            className="text-xs text-stellar-400 hover:text-stellar-700 transition-colors"
          >
            Disconnect
          </button>
        </>
      ) : (
        <button
          onClick={connect}
          className="rounded-lg bg-stellar-600 px-4 py-2 text-sm font-semibold text-white shadow hover:bg-stellar-700 transition-colors"
        >
          Connect Wallet
        </button>
      )}
    </div>
  );
}