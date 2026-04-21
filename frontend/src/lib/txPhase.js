// Derives a single phase string from wagmi's useWriteContract +
// useWaitForTransactionReceipt outputs. Useful for showing distinct UI for
// "waiting on user signature" vs "waiting on chain confirmation".
//
// Returns one of: 'idle' | 'waiting-signature' | 'pending' | 'success' | 'error'.
export function deriveTxPhase({ isPending, isConfirming, isSuccess, hash, error }) {
  if (error) return 'error';
  if (isSuccess) return 'success';
  if (isPending && !hash) return 'waiting-signature';
  if (hash && isConfirming) return 'pending';
  if (hash) return 'pending';
  return 'idle';
}

export const TX_PHASE_LABELS = {
  idle: 'Ready',
  'waiting-signature': 'Waiting for wallet signature…',
  pending: 'Confirming on-chain…',
  success: 'Confirmed',
  error: 'Failed',
};
