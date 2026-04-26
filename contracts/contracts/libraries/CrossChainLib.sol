// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/**
 * @title CrossChainLib
 * @notice External library for cross-chain (Khalani) intent verification.
 *
 *         Splits the EIP-712 hash + ECDSA recovery used by AegisVault_v3's
 *         `acceptCrossChainFill` path into its own bytecode object so the v3
 *         vault implementation stays under EIP-170 (24 KB) on 0G mainnet.
 *
 *         Mirrors the SealedLib pattern: pure helpers, custom errors, no state.
 *
 *         Domain separator MUST match v2's ExecLib (`AegisVault`, version `1`,
 *         current `chainId`, `verifyingContract = vault address`) so the
 *         off-chain signer (orchestrator + TEE) can reuse the existing 712
 *         setup unchanged.
 */
library CrossChainLib {
    error InvalidCrossChainSignature();
    error MissingAttestationReport();
    error CrossChainRequiresAttestedSigner();

    // ── Cross-chain intent struct (mirrors AegisVault_v3.CrossChainIntent) ──
    //
    //   This is a copy of the user-facing struct, kept inside the library so
    //   the typehash and `computeIntentHash` helper can encode it without
    //   touching v1/v2 surface. The vault re-declares the same struct in its
    //   external ABI; field order and types must match exactly.
    struct CrossChainIntent {
        address vault;
        address assetIn;
        address assetOut;
        uint256 amountIn;
        uint256 minAmountOut;
        uint256 createdAt;
        uint256 expiresAt;
        uint16  confidenceBps;
        uint16  riskScoreBps;
        bytes32 attestationReportHash;
        uint64  routeChainId;
        uint16  maxFeeBps;
        bytes32 routePolicyHash;
        bytes32 khalaniIntentId;
    }

    // ── EIP-712 ──
    //
    //   Typehash includes every field of CrossChainIntent in declaration order.
    //   Off-chain signer (orchestrator) MUST hash an identical type string —
    //   any drift breaks signature verification.
    bytes32 internal constant CROSS_CHAIN_INTENT_TYPEHASH = keccak256(
        "CrossChainIntent(address vault,address assetIn,address assetOut,uint256 amountIn,uint256 minAmountOut,uint256 createdAt,uint256 expiresAt,uint16 confidenceBps,uint16 riskScoreBps,bytes32 attestationReportHash,uint64 routeChainId,uint16 maxFeeBps,bytes32 routePolicyHash,bytes32 khalaniIntentId)"
    );
    bytes32 internal constant DOMAIN_TYPE_HASH = keccak256(
        "EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"
    );
    bytes32 internal constant NAME_HASH    = keccak256("AegisVault");
    bytes32 internal constant VERSION_HASH = keccak256("1");

    /// @notice Compute the EIP-712 digest for a CrossChainIntent.
    /// @dev    The vault must pass its own address as `verifyingContract`
    ///         because this library is invoked via its deployed address —
    ///         `address(this)` inside the library would resolve to the
    ///         library, not the vault.
    function computeIntentHash(
        CrossChainIntent calldata intent,
        address verifyingContract,
        uint256 chainId
    ) external pure returns (bytes32) {
        return _hash(intent, verifyingContract, chainId);
    }

    /// @notice Verify the orchestrator/TEE ECDSA signature over the intent digest.
    /// @return digest the EIP-712 digest that was verified (caller uses it as
    ///                the unique intent ID for replay tracking).
    function verifySignature(
        CrossChainIntent calldata intent,
        address verifyingContract,
        uint256 chainId,
        address attestedSigner,
        bytes calldata sig
    ) external pure returns (bytes32 digest) {
        if (attestedSigner == address(0)) revert CrossChainRequiresAttestedSigner();
        if (intent.attestationReportHash == bytes32(0)) revert MissingAttestationReport();

        digest = _hash(intent, verifyingContract, chainId);

        address recovered = _recoverSigner(digest, sig);
        if (recovered != attestedSigner) revert InvalidCrossChainSignature();
    }

    function _hash(
        CrossChainIntent calldata intent,
        address verifyingContract,
        uint256 chainId
    ) private pure returns (bytes32) {
        bytes32 structHash = keccak256(abi.encode(
            CROSS_CHAIN_INTENT_TYPEHASH,
            intent.vault,
            intent.assetIn,
            intent.assetOut,
            intent.amountIn,
            intent.minAmountOut,
            intent.createdAt,
            intent.expiresAt,
            intent.confidenceBps,
            intent.riskScoreBps,
            intent.attestationReportHash,
            intent.routeChainId,
            intent.maxFeeBps,
            intent.routePolicyHash,
            intent.khalaniIntentId
        ));
        bytes32 domainSeparator = keccak256(abi.encode(
            DOMAIN_TYPE_HASH,
            NAME_HASH,
            VERSION_HASH,
            chainId,
            verifyingContract
        ));
        return keccak256(abi.encodePacked("\x19\x01", domainSeparator, structHash));
    }

    function _recoverSigner(bytes32 hash, bytes calldata sig) private pure returns (address) {
        if (sig.length != 65) return address(0);
        bytes32 r;
        bytes32 s;
        uint8 v;
        assembly {
            r := calldataload(sig.offset)
            s := calldataload(add(sig.offset, 32))
            v := byte(0, calldataload(add(sig.offset, 64)))
        }
        if (v < 27) v += 27;
        if (v != 27 && v != 28) return address(0);
        if (uint256(s) > 0x7FFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF5D576E7357A4501DDFE92F46681B20A0) {
            return address(0);
        }
        return ecrecover(hash, v, r, s);
    }
}
