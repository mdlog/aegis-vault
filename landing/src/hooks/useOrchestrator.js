import { useState, useEffect, useCallback } from 'react';
import { ORCHESTRATOR_URL } from '../lib/contracts.js';

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
export function useJournal(limit = 20) {
  return useAPI(`/api/journal?limit=${limit}`, { interval: 10000 });
}

export function useDecisions(limit = 10) {
  return useAPI(`/api/journal/decisions?limit=${limit}`, { interval: 10000 });
}

export function useExecutions(limit = 10) {
  return useAPI(`/api/journal/executions?limit=${limit}`, { interval: 10000 });
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

  const addrs = vaultAddresses || [];
  const key = addrs.join(',');

  const fetchTVL = useCallback(async () => {
    if (addrs.length === 0) { setTvl(0); setLoading(false); return; }
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
      const res = await fetch(`${ORCHESTRATOR_URL}/api/cycle`, { method: 'POST' });
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
export function useOrchestratorVault() {
  return useAPI('/api/vault', { interval: 10000 });
}
