// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/**
 * @title CrossChainLibV4
 * @notice V4-specific cross-chain (Khalani) intent verification library.
 *
 *         Functionally a drop-in replacement for {CrossChainLib} that extends
 *         the {CrossChainIntent} struct with `strategyHash` and
 *         `strategySchemaVer`. AegisVault_v4 binds these to its on-chain
 *         `acceptedManifestHash` so the strategy commitment that protects
 *         `executeIntent` is also enforced on the Khalani settlement path.
 *
 *         Without the V4 extension a malicious operator (or a stolen TEE
 *         signing key) could deviate from the manifest the depositor accepted
 *         simply by routing trades through Khalani — `acceptCrossChainFill`
 *         would never see the strategyHash mismatch.
 *
 *         Domain identity matches V3 ("AegisVault", "1", chainId, vault) so
 *         the existing TEE keystore is reused across all intent surfaces. The
 *         typehash is necessarily different from V3's because the encoded
 *         struct shape changed; this is intentional and prevents a V3
 *         signature from being replayed against a V4 vault and vice versa.
 */
library CrossChainLibV4 {
    error InvalidCrossChainSignature();
    error MissingAttestationReport();
    error CrossChainRequiresAttestedSigner();

    /// @notice V4 cross-chain intent. Mirrors {CrossChainLib.CrossChainIntent}
    ///         with `strategyHash` and `strategySchemaVer` appended at the
    ///         end so the off-chain canonical builder can keep the V3 field
    ///         layout for the first 15 fields unchanged.
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
        uint256 prevBalance;
        bytes32 strategyHash;
        uint32  strategySchemaVer;
    }

    bytes32 internal constant CROSS_CHAIN_INTENT_TYPEHASH_V4 = keccak256(
        "CrossChainIntent(address vault,address assetIn,address assetOut,uint256 amountIn,uint256 minAmountOut,uint256 createdAt,uint256 expiresAt,uint16 confidenceBps,uint16 riskScoreBps,bytes32 attestationReportHash,uint64 routeChainId,uint16 maxFeeBps,bytes32 routePolicyHash,bytes32 khalaniIntentId,uint256 prevBalance,bytes32 strategyHash,uint32 strategySchemaVer)"
    );
    bytes32 internal constant DOMAIN_TYPE_HASH = keccak256(
        "EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"
    );
    bytes32 internal constant NAME_HASH    = keccak256("AegisVault");
    bytes32 internal constant VERSION_HASH = keccak256("1");

    /// @notice Compute the EIP-712 digest for a V4 CrossChainIntent.
    function computeIntentHash(
        CrossChainIntent calldata intent,
        address verifyingContract,
        uint256 chainId
    ) external pure returns (bytes32) {
        return _hash(intent, verifyingContract, chainId);
    }

    /// @notice Verify the orchestrator/TEE ECDSA signature over the digest.
    /// @return digest the EIP-712 digest that was verified (caller uses it
    ///                as the unique intent ID for replay tracking).
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
            CROSS_CHAIN_INTENT_TYPEHASH_V4,
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
            intent.khalaniIntentId,
            intent.prevBalance,
            intent.strategyHash,
            intent.strategySchemaVer
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
        // EIP-2 secp256k1 half-order check — reject malleable signatures.
        if (uint256(s) > 0x7FFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF5D576E7357A4501DDFE92F46681B20A0) {
            return address(0);
        }
        return ecrecover(hash, v, r, s);
    }
}
