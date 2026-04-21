// Maps low-level viem/wagmi/EVM errors into user-friendly explanations.
// Use parseTxError(error) to get { title, message, isUserReject, code }.

const REVERT_HINTS = [
  { match: /insufficient.*allowance|ERC20InsufficientAllowance/i,
    title: 'Token approval is too small',
    message: 'Approve a higher allowance for this token first, then retry.' },
  { match: /insufficient.*balance|ERC20InsufficientBalance|transfer amount exceeds balance/i,
    title: 'Insufficient token balance',
    message: 'Your wallet does not hold enough tokens for this action. Mint test tokens at the faucet or top up.' },
  { match: /insufficient funds for gas/i,
    title: 'Not enough gas',
    message: 'Your wallet does not have enough native token to cover gas. Top up and retry.' },
  { match: /nonce too low|already known/i,
    title: 'Stale transaction',
    message: 'Wallet nonce is out of sync. Reset the account in MetaMask (Settings → Advanced → Clear activity) and retry.' },
  { match: /replacement transaction underpriced/i,
    title: 'Replacement underpriced',
    message: 'A pending transaction with the same nonce exists. Cancel or speed it up in your wallet.' },
  { match: /TierCapExceeded|cap exceeded/i,
    title: 'Operator tier cap exceeded',
    message: 'This operator cannot accept a vault this large at their current stake tier. Reduce deposit or pick a different operator.' },
  { match: /OperatorFrozen|frozen/i,
    title: 'Operator is frozen',
    message: 'The selected operator is paused for arbitration. Pick a different operator and try again.' },
  { match: /NotOwner|caller is not the owner|Ownable/i,
    title: 'Permission denied',
    message: 'Your wallet is not authorized for this action. Check that you are connected to the correct account.' },
  { match: /AlreadyRegistered/i,
    title: 'Already registered',
    message: 'This wallet is already registered as an operator. Use the Update flow instead.' },
  { match: /InvalidFee|fee.*exceeds|FeeTooHigh/i,
    title: 'Fee exceeds protocol cap',
    message: 'One of the fee values is above the protocol-enforced maximum. Lower the fee and retry.' },
  { match: /paused|Pausable: paused/i,
    title: 'Contract is paused',
    message: 'This action is temporarily disabled by the contract. Try again later.' },
  { match: /timeout|timed out/i,
    title: 'Network timeout',
    message: 'The RPC took too long to respond. Check your connection and retry.' },
  { match: /chain.*mismatch|wrong network/i,
    title: 'Wrong network',
    message: 'Switch your wallet to the correct network and retry.' },
];

function isUserRejection(err) {
  if (!err) return false;
  const msg = err.shortMessage || err.message || String(err);
  return (
    /user rejected|user denied|rejected the request|UserRejectedRequestError/i.test(msg) ||
    err.cause?.code === 4001 ||
    err.code === 4001
  );
}

export function parseTxError(error) {
  if (!error) return null;
  if (isUserRejection(error)) {
    return {
      title: 'Transaction rejected',
      message: 'You rejected the transaction in your wallet.',
      isUserReject: true,
      code: 4001,
      raw: error.shortMessage || error.message || '',
    };
  }
  const raw = error.shortMessage || error.message || String(error);
  for (const hint of REVERT_HINTS) {
    if (hint.match.test(raw)) {
      return { title: hint.title, message: hint.message, isUserReject: false, raw };
    }
  }
  // Fall back: trim noise from viem multi-line errors, keep first line
  const firstLine = String(raw).split('\n')[0].slice(0, 240);
  return {
    title: 'Transaction failed',
    message: firstLine || 'The transaction reverted. Check the explorer for details.',
    isUserReject: false,
    raw,
  };
}

// Convenience: log + show toast in one call. Caller passes the toast function
// (we keep this module dependency-free so it can be used in non-React code).
export function describeTxError(error) {
  const parsed = parseTxError(error);
  if (!parsed) return null;
  return {
    ...parsed,
    short: parsed.title,
    long: parsed.message,
  };
}
