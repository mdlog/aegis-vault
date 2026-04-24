// Error taxonomy for Aegis Vault SDK consumers.
//
// Raw ethers errors are noisy and inconsistent (provider vs contract vs user-
// rejection), and custom-error selectors come through as 4-byte hex that means
// nothing to an end user. `parseContractError` normalises all of that into
// `{ title, message, isUserReject, code, raw }` — safe to surface in a toast.
//
// The revert hints below are cross-referenced with:
//   - `contracts/` custom error names (e.g. TierCapExceeded, OperatorFrozen)
//   - ERC-20 standard errors (ERC20InsufficientAllowance, etc.)
//   - Common wallet / RPC failure modes (nonce, gas, chain mismatch)

const REVERT_HINTS = [
  { match: /insufficient.*allowance|ERC20InsufficientAllowance/i,
    title: 'Token approval is too small',
    message: 'Approve a higher allowance for this token first, then retry.' },
  { match: /insufficient.*balance|ERC20InsufficientBalance|transfer amount exceeds balance/i,
    title: 'Insufficient token balance',
    message: 'Your wallet does not hold enough tokens for this action.' },
  { match: /insufficient funds for gas|insufficient funds for intrinsic/i,
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
  { match: /NotAuthorizedVault/i,
    title: 'Vault not authorized',
    message: 'This vault is not registered with the execution registry. Contact the admin.' },
  { match: /IntentAlreadyFinalized/i,
    title: 'Intent already finalized',
    message: 'This intent has already been executed or cancelled. Submit a new intent instead.' },
  { match: /IntentAlreadySubmitted/i,
    title: 'Intent already submitted',
    message: 'This intent hash is already in the registry. Wait for it to finalize.' },
  { match: /IntentOwnerMismatch/i,
    title: 'Intent owner mismatch',
    message: 'The intent is bound to a different vault than the one executing it.' },
  { match: /InvalidFee|fee.*exceeds|FeeTooHigh|MAX_.*_FEE_BPS/i,
    title: 'Fee exceeds protocol cap',
    message: 'One of the fee values is above the protocol-enforced maximum. Lower the fee and retry.' },
  { match: /paused|Pausable: paused/i,
    title: 'Contract is paused',
    message: 'This action is temporarily disabled by the contract. Try again later.' },
  { match: /ZeroAddress/i,
    title: 'Zero address not allowed',
    message: 'One of the addresses you passed is 0x000…. Check your inputs.' },
  { match: /FailedDeployment/i,
    title: 'Vault deployment failed',
    message: 'The factory could not deploy a new vault. Check gas, factory admin status, and retry.' },
  { match: /timeout|timed out/i,
    title: 'Network timeout',
    message: 'The RPC took too long to respond. Check your connection and retry.' },
  { match: /chain.*mismatch|wrong network|UnsupportedChain/i,
    title: 'Wrong network',
    message: 'Switch your wallet to the correct network and retry.' },
];

const USER_REJECT_PATTERNS = /user rejected|user denied|rejected the request|UserRejectedRequestError|ACTION_REJECTED/i;

/**
 * Detect wallet-level user rejections across ethers (v5/v6), viem, and raw
 * EIP-1193 providers. Centralised so callers don't have to know which shape
 * to check.
 */
export function isUserRejection(err) {
  if (!err) return false;
  if (err.code === 'ACTION_REJECTED' || err.code === 4001) return true;
  if (err.cause?.code === 4001) return true;
  const msg = err.shortMessage || err.message || String(err);
  return USER_REJECT_PATTERNS.test(msg);
}

/**
 * Recursively flatten nested ethers errors to find the deepest meaningful
 * message. Ethers v6 wraps revert data several layers deep (`err.info.error.data`,
 * `err.error.message`, etc.) — this picks the most specific non-empty string.
 */
function extractMessage(err) {
  const pieces = [
    err.shortMessage,
    err.reason,
    err.revert?.name,
    err.info?.error?.message,
    err.error?.message,
    err.cause?.message,
    err.cause?.shortMessage,
    err.message,
  ].filter(Boolean);
  return pieces.join(' | ');
}

/**
 * Parse any contract / RPC / wallet error into a consistent shape.
 *
 * @param {unknown} error
 * @returns {{title: string, message: string, isUserReject: boolean, code?: number|string, raw: string} | null}
 */
export function parseContractError(error) {
  if (!error) return null;

  if (isUserRejection(error)) {
    return {
      title: 'Transaction rejected',
      message: 'You rejected the transaction in your wallet.',
      isUserReject: true,
      code: 4001,
      raw: error.shortMessage || error.message || String(error),
    };
  }

  const raw = extractMessage(error) || String(error);

  for (const hint of REVERT_HINTS) {
    if (hint.match.test(raw)) {
      return { title: hint.title, message: hint.message, isUserReject: false, raw };
    }
  }

  // Fallback: keep just the first line (ethers v6 errors can span 10+ lines
  // with stack traces, JSON-RPC payloads, etc.)
  const firstLine = String(raw).split('\n')[0].slice(0, 240);
  return {
    title: 'Transaction failed',
    message: firstLine || 'The transaction reverted. Check the explorer for details.',
    isUserReject: false,
    code: error.code,
    raw,
  };
}

/**
 * Alias — same shape as parseContractError, for symmetry with the frontend
 * helper that predated the SDK.
 */
export const parseTxError = parseContractError;
