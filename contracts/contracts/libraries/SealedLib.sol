// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/**
 * @title SealedLib
 * @notice External library for Track 2 sealed-mode TEE attestation verification.
 *         Split out from ExecLib so each library bytecode fits 0G mainnet's tight
 *         per-block gas limit.
 */
library SealedLib {
    error InvalidAttestationSignature();
    error MissingAttestationReport();
    error SealedModeRequiresAttestedSigner();

    /// @notice Verify a TEE attestation signature for sealed mode.
    /// @return commitHash keccak(intentHash, attestationReportHash) — caller must check intentCommits[commitHash]
    function verifyAttestation(
        bytes32 intentHash,
        bytes32 attestationReportHash,
        address attestedSigner,
        bytes calldata sig
    ) external pure returns (bytes32 commitHash) {
        if (attestedSigner == address(0)) revert SealedModeRequiresAttestedSigner();
        if (attestationReportHash == bytes32(0)) revert MissingAttestationReport();

        bytes32 ethSignedHash = keccak256(abi.encodePacked("\x19Ethereum Signed Message:\n32", intentHash));
        address recovered = _recoverSigner(ethSignedHash, sig);
        if (recovered != attestedSigner) revert InvalidAttestationSignature();

        commitHash = keccak256(abi.encodePacked(intentHash, attestationReportHash));
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
