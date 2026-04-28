import { useEffect, useMemo, useState } from 'react';
import { keccak256, toBytes } from 'viem';
import { useOperatorExtended } from './useOperatorRegistry';

// useOperatorStrategy
// -------------------
// Fetch + verify the strategy manifest a marketplace operator has bound on
// the OperatorRegistry, and return a UI-friendly summary alongside the raw
// strategy JSON.
//
// Flow (mirrors orchestrator/src/strategy/loader.js):
//   1. wagmi-read OperatorRegistry.getOperatorExtended(operator) →
//      { manifestURI, manifestHash, manifestVersion, manifestBonded }
//   2. If the URI is empty or hash is zero — operator hasn't published a
//      schema-v1 strategy. Return `{ strategy: null, summary: null, ... }`
//      so the caller can render "uses default Decision Engine".
//   3. Fetch the manifest content over https / ipfs gateway.
//   4. Recompute keccak256(canonical UTF-8 JSON) and compare to manifestHash.
//      Mismatch → set `error` and return null strategy (don't render
//      tampered content as "the operator's strategy").
//   5. The operator manifest may either be a strategy-shaped doc directly or
//      a wrapper containing { strategy: {schemaVersion: 1, ...} }. We accept
//      both shapes and surface the inner strategy block to consumers.
//
// We intentionally inline the canonical JSON + hash + summarize logic
// instead of pulling the SDK in: the SDK depends on `ethers` and the
// frontend uses `viem`, so we keep them isolated. The canonical-JSON
// algorithm here is byte-identical to sdk/src/manifest.js
// `canonicalizeJson` and orchestrator/src/strategy/hash.js — that's the
// invariant on-chain hash verification depends on.

const ZERO_HASH = '0x0000000000000000000000000000000000000000000000000000000000000000';
const IPFS_GATEWAY = (typeof import.meta !== 'undefined' && import.meta.env?.VITE_IPFS_GATEWAY)
  || 'https://ipfs.io/ipfs/';

export function useOperatorStrategy(operatorAddress, registryAddress) {
  // Step 1: read the on-chain manifest pointer.
  const { data: extended, isLoading: isLoadingExtended, error: registryError } =
    useOperatorExtended(registryAddress, operatorAddress);

  const manifestURI = extended?.manifestURI || '';
  const manifestHash = extended?.manifestHash || ZERO_HASH;
  const manifestVersion = Number(extended?.manifestVersion || 0);
  const manifestBonded = Boolean(extended?.manifestBonded);

  const hasManifest = Boolean(manifestURI) && manifestHash !== ZERO_HASH;

  const [state, setState] = useState({
    strategy: null,
    summary: null,
    error: null,
    isFetching: false,
  });

  // Step 2-5: fetch, verify, parse.
  useEffect(() => {
    let cancelled = false;
    if (!hasManifest) {
      setState({ strategy: null, summary: null, error: null, isFetching: false });
      return () => { cancelled = true; };
    }

    setState((s) => ({ ...s, isFetching: true, error: null }));

    (async () => {
      try {
        const url = resolveManifestUrl(manifestURI, IPFS_GATEWAY);
        const res = await fetch(url);
        if (!res.ok) throw new Error(`fetch ${url} → HTTP ${res.status}`);
        const text = await res.text();

        let parsed;
        try {
          parsed = JSON.parse(text);
        } catch (err) {
          throw new Error(`manifest at ${manifestURI} is not valid JSON: ${err.message}`);
        }

        // Recompute hash from canonical JSON of the parsed object.
        const canonical = canonicalizeJson(parsed);
        const actualHash = keccak256(toBytes(canonical));
        if (actualHash.toLowerCase() !== String(manifestHash).toLowerCase()) {
          throw new Error(
            `Strategy hash mismatch — expected ${manifestHash}, got ${actualHash}. The manifest at ${manifestURI} may have been modified after publication.`,
          );
        }

        // Accept either strategy-shaped manifest OR an operator manifest
        // that embeds a `strategy` block.
        const strategy = looksLikeStrategy(parsed)
          ? parsed
          : (parsed.strategy && looksLikeStrategy(parsed.strategy) ? parsed.strategy : null);

        if (!strategy) {
          // Manifest hashes match but the doc isn't a v1 strategy — treat
          // as "no strategy" for UI purposes.
          if (!cancelled) {
            setState({ strategy: null, summary: null, error: null, isFetching: false });
          }
          return;
        }

        if (!cancelled) {
          setState({
            strategy,
            summary: summarizeStrategy(strategy),
            error: null,
            isFetching: false,
          });
        }
      } catch (err) {
        if (!cancelled) {
          setState({
            strategy: null,
            summary: null,
            error: err.message || String(err),
            isFetching: false,
          });
        }
      }
    })();

    return () => { cancelled = true; };
    // manifestHash uniquely identifies the content (hash-addressed), so we
    // re-fetch only when the operator publishes a new version.
  }, [hasManifest, manifestURI, manifestHash]);

  return useMemo(() => ({
    hasManifest,
    manifestURI,
    manifestHash,
    manifestVersion,
    manifestBonded,
    strategy: state.strategy,
    summary: state.summary,
    error: state.error || (registryError?.message ?? null),
    isLoading: isLoadingExtended || state.isFetching,
  }), [
    hasManifest, manifestURI, manifestHash, manifestVersion, manifestBonded,
    state.strategy, state.summary, state.error,
    isLoadingExtended, state.isFetching, registryError,
  ]);
}

// ── helpers ──

function resolveManifestUrl(uri, ipfsGateway) {
  const lower = uri.toLowerCase();
  if (lower.startsWith('ipfs://')) return `${ipfsGateway}${uri.slice('ipfs://'.length)}`;
  return uri;
}

function looksLikeStrategy(obj) {
  return Boolean(
    obj && typeof obj === 'object'
    && obj.schemaVersion === 1
    && obj.strategy && typeof obj.strategy === 'object'
    && obj.scoring && typeof obj.scoring === 'object'
    && obj.scoring.weights && typeof obj.scoring.weights === 'object'
    && obj.ai && typeof obj.ai === 'object',
  );
}

// Pull the UI-relevant fields out of a strategy. Mirrors
// sdk/src/strategy.js summarizeStrategy(); kept inline so the frontend
// doesn't need an ethers-dependent import path.
export function summarizeStrategy(strategy) {
  if (!looksLikeStrategy(strategy)) return null;
  return {
    schemaVersion: strategy.schemaVersion,
    id: strategy.strategy.id,
    name: strategy.strategy.name,
    type: strategy.strategy.type,
    timeframe: strategy.strategy.timeframe,
    description: strategy.strategy.description ?? null,
    aiModel: strategy.ai.model,
    aiMode: strategy.ai.mode,
    aiProviderAddress: strategy.ai.providerAddress,
    weights: strategy.scoring.weights,
    allowedRegimes: strategy.gates?.allowedBuyRegimes || [],
    allowedSellRegimes: strategy.gates?.allowedSellRegimes || [],
    minConfidence: strategy.gates?.minConfidenceBuy ?? null,
    minEdge: strategy.gates?.minEdgeBuy ?? null,
    maxRisk: strategy.gates?.maxRiskBuy ?? null,
  };
}

// Canonical JSON serialiser — byte-identical to sdk/src/manifest.js
// `canonicalizeJson` and orchestrator/src/strategy/hash.js. DO NOT change
// behaviour here without updating both other implementations: any drift
// breaks hash verification on every cycle.
export function canonicalizeJson(value) {
  return stringify(value, new Set());
}

function stringify(value, seen) {
  if (value === null) return 'null';
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      throw new Error(`canonicalizeJson: non-finite number ${value}`);
    }
    return JSON.stringify(value);
  }
  if (typeof value === 'bigint') return JSON.stringify(value.toString());
  if (typeof value === 'string') return JSON.stringify(value);
  if (Array.isArray(value)) {
    if (seen.has(value)) throw new Error('canonicalizeJson: circular reference');
    seen.add(value);
    const out = '[' + value.map((v) => stringify(v, seen)).join(',') + ']';
    seen.delete(value);
    return out;
  }
  if (typeof value === 'object') {
    if (seen.has(value)) throw new Error('canonicalizeJson: circular reference');
    seen.add(value);
    const keys = Object.keys(value).sort();
    const parts = keys.map((k) => JSON.stringify(k) + ':' + stringify(value[k], seen));
    seen.delete(value);
    return '{' + parts.join(',') + '}';
  }
  throw new Error(`canonicalizeJson: cannot serialize ${typeof value}`);
}
