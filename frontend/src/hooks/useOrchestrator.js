import { useState, useEffect, useCallback } from 'react';
import { ORCHESTRATOR_URL } from '../lib/contracts.js';

const ORCHESTRATOR_API_KEY = import.meta.env.VITE_ORCHESTRATOR_API_KEY || '';

function buildQuery(params = {}) {
  const query = new URLSearchParams();

  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && value !== '') {
      query.set(key, value);
    }
  }

  const queryString = query.toString();
  return queryString ? `?${queryString}` : '';
}

function getMutationHeaders() {
  return ORCHESTRATOR_API_KEY ? { 'x-api-key': ORCHESTRATOR_API_KEY } : {};
}

/**
 * Generic fetch hook for orchestrator API
 */
function useAPI(endpoint, options = {}) {
  const { interval = 0, enabled = true } = options;
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const fetchData = useCallback(async () => {
    if (!enabled) return;
    try {
      const res = await fetch(`${ORCHESTRATOR_URL}${endpoint}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      setData(json);
      setError(null);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [endpoint, enabled]);

  useEffect(() => {
    fetchData();
    if (interval > 0) {
      const id = setInterval(fetchData, interval);
      return () => clearInterval(id);
    }
  }, [fetchData, interval]);

  return { data, loading, error, refetch: fetchData };
}

// ── Orchestrator Status ──
export function useOrchestratorStatus() {
  return useAPI('/api/status', { interval: 5000 });
}

// ── Market Data ──
export function useMarketData() {
  return useAPI('/api/market', { interval: 30000 });
}

export function useMarketSummary() {
  return useAPI('/api/market/summary', { interval: 30000 });
}

// ── Journal ──
export function useJournal(limit = 20, options = {}) {
  const { vaultAddress, type, level, interval = 10000 } = options;
  return useAPI(`/api/journal${buildQuery({ limit, vault: vaultAddress, type, level })}`, { interval });
}

export function useDecisions(limit = 10, options = {}) {
  const { vaultAddress, interval = 10000 } = options;
  return useAPI(`/api/journal/decisions${buildQuery({ limit, vault: vaultAddress })}`, { interval });
}

export function useExecutions(limit = 10, options = {}) {
  const { vaultAddress, interval = 10000 } = options;
  return useAPI(`/api/journal/executions${buildQuery({ limit, vault: vaultAddress })}`, { interval });
}

export function useAlerts(limit = 10, options = {}) {
  const { vaultAddress, level, interval = 10000 } = options;
  return useAPI(`/api/alerts${buildQuery({ limit, vault: vaultAddress, level })}`, { interval });
}

// ── Pyth / NAV ──
export function useMultiAssetNAV(vaultAddress) {
  const endpoint = vaultAddress ? `/api/nav?vault=${vaultAddress}` : '/api/nav';
  return useAPI(endpoint, { interval: 15000, enabled: !!vaultAddress });
}

export function usePythPrices() {
  return useAPI('/api/pyth/prices', { interval: 15000 });
}

// ── Platform TVL (sum NAV of all vaults) ──
export function usePlatformTVL(vaultAddresses) {
  const [tvl, setTvl] = useState(0);
  const [loading, setLoading] = useState(true);
  const [source, setSource] = useState('');

  const key = (vaultAddresses || []).filter(Boolean).join(',');

  const fetchTVL = useCallback(async () => {
    const addrs = key ? key.split(',') : [];

    if (addrs.length === 0) {
      setTvl(0);
      setLoading(false);
      setSource('');
      return;
    }

    try {
      const results = await Promise.all(
        addrs.map(addr =>
          fetch(`${ORCHESTRATOR_URL}/api/nav?vault=${addr}`)
            .then(r => r.ok ? r.json() : { totalNav: 0 })
            .catch(() => ({ totalNav: 0 }))
        )
      );
      const total = results.reduce((sum, r) => sum + (r.totalNav || 0), 0);
      setTvl(total);
      setSource(results.some(r => r.source === 'pyth-hermes') ? 'Pyth Oracle' : 'Base asset');
    } catch {
      setTvl(0);
    } finally {
      setLoading(false);
    }
  }, [key]);

  useEffect(() => {
    fetchTVL();
    const id = setInterval(fetchTVL, 30000);
    return () => clearInterval(id);
  }, [fetchTVL]);

  return { tvl, loading, source };
}

// ── KV State ──
export function useKVState() {
  return useAPI('/api/state', { interval: 5000 });
}

// ── 0G Storage Status ──
export function useOGStorageStatus() {
  return useAPI('/api/og/status');
}

// ── Trigger Manual Cycle ──
export function useTriggerCycle() {
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);

  const trigger = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`${ORCHESTRATOR_URL}/api/cycle`, {
        method: 'POST',
        headers: getMutationHeaders(),
      });
      const json = await res.json();
      setResult(json);
      return json;
    } catch (err) {
      setError(err.message);
      return null;
    } finally {
      setLoading(false);
    }
  }, []);

  return { trigger, loading, result, error };
}

// ── Vault State from Orchestrator (richer than on-chain read) ──
export function useOrchestratorVault(vaultAddress) {
  const endpoint = `/api/vault${buildQuery({ vault: vaultAddress })}`;
  return useAPI(endpoint, { interval: 10000, enabled: !!vaultAddress });
}


// ── 0G Compute model discovery (for operator register dropdown) ──
export function useAvailableAIModels() {
  return useAPI("/api/og-compute/models", { interval: 0 }); // fetch once
}

