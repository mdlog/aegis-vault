import { useEffect, useState } from 'react';
import { AlertTriangle, CheckCircle, Hourglass, RefreshCw, X } from 'lucide-react';
import {
  diffVaultOperatorManifest,
  useApplyManifestUpgrade,
  useCancelManifestUpgrade,
  useRequestManifestUpgrade,
  useVaultManifestHash,
} from '../../hooks/useVault';
import { useOperatorStrategy } from '../../hooks/useOperatorStrategy';
import { shortHexLabel, getDeployments } from '../../lib/contracts';
import ControlButton from '../ui/ControlButton';

/**
 * V4ManifestPanel — strategy manifest binding + upgrade flow.
 *
 * V4 vaults bind an `acceptedManifestHash` at create time. This panel:
 *   1. Surfaces the vault's current accepted hash + the operator's
 *      currently published hash.
 *   2. Highlights drift between the two with a clear warning badge.
 *   3. If a pending upgrade is queued, shows the 24-hour countdown.
 *   4. Lets the vault owner request, apply, or cancel a manifest upgrade.
 *
 * Renders nothing on V3/V2/V1 vaults — those have no manifest binding.
 */
export default function V4ManifestPanel({
  vaultAddress,
  operatorAddress,
  vaultVersion,
  isOwner,
}) {
  const isV4 = vaultVersion === 'v4';

  const {
    acceptedManifestHash,
    pendingManifestHash,
    hasManifestSupport,
    hasPendingUpgrade,
    readyAt,
    refetch,
  } = useVaultManifestHash(vaultAddress, { enabled: isV4 });

  const deployments = getDeployments();
  const operatorRegistry =
    deployments.operatorRegistryV2 || deployments.operatorRegistry;
  const { strategy: operatorStrategy, manifestHash: operatorHash } =
    useOperatorStrategy(operatorAddress, operatorRegistry);

  const { requestManifestUpgrade, isPending: requestPending, isSuccess: requestOk } =
    useRequestManifestUpgrade();
  const { applyManifestUpgrade, isPending: applyPending, isSuccess: applyOk } =
    useApplyManifestUpgrade();
  const { cancelManifestUpgrade, isPending: cancelPending, isSuccess: cancelOk } =
    useCancelManifestUpgrade();

  // Live tick for the countdown. State init reads Date.now() once via the
  // initialiser-function form so it doesn't violate react-hooks/purity.
  const [nowSec, setNowSec] = useState(() => Math.floor(Date.now() / 1000));
  useEffect(() => {
    if (!hasPendingUpgrade) return undefined;
    const id = setInterval(() => setNowSec(Math.floor(Date.now() / 1000)), 1000);
    return () => clearInterval(id);
  }, [hasPendingUpgrade]);

  // Refetch on tx success so the UI updates immediately.
  useEffect(() => {
    if (requestOk || applyOk || cancelOk) refetch?.();
  }, [requestOk, applyOk, cancelOk, refetch]);

  // V3/V2/V1 vaults: nothing to show here.
  if (!isV4) return null;

  // The contract supports it but the read is still in flight or returned null.
  if (!hasManifestSupport) return null;

  const diff = diffVaultOperatorManifest(acceptedManifestHash, operatorHash);

  // Derive countdown from the live tick state — pure during render.
  const secondsUntilReady = hasPendingUpgrade ? Math.max(0, readyAt - nowSec) : 0;
  const upgradeReady = hasPendingUpgrade && secondsUntilReady === 0;
  const hh = Math.floor(secondsUntilReady / 3600);
  const mm = Math.floor((secondsUntilReady % 3600) / 60);
  const ss = secondsUntilReady % 60;
  const countdownLabel =
    upgradeReady ? 'Ready to apply'
    : hasPendingUpgrade ? `${hh}h ${mm}m ${ss}s remaining`
    : null;

  return (
    <section
      className="rounded-2xl border p-5 ed-rise"
      style={{
        background: 'var(--ed-bg-canvas)',
        borderColor: 'var(--ed-line-soft)',
        '--ed-rise-d': '210ms',
      }}
    >
      <header className="flex items-center justify-between mb-4">
        <div>
          <div
            className="text-[10px] uppercase tracking-[0.18em] mb-1"
            style={{ color: 'var(--ed-steel-300)' }}
          >
            V4 Strategy Manifest
          </div>
          <div className="ed-display text-base" style={{ color: 'var(--ed-steel-50)' }}>
            On-chain commitment
          </div>
        </div>
        <DiffBadge diff={diff} />
      </header>

      <div className="space-y-3 text-[12px]" style={{ color: 'var(--ed-steel-100)' }}>
        <Row label="Accepted hash">
          <code style={{ color: 'var(--ed-steel-50)' }}>
            {acceptedManifestHash ? shortHexLabel(acceptedManifestHash) : '—'}
          </code>
        </Row>
        <Row label="Operator current hash">
          <code style={{ color: 'var(--ed-steel-50)' }}>
            {operatorHash ? shortHexLabel(operatorHash) : '— (no manifest)'}
          </code>
        </Row>
        {operatorStrategy?.strategy && (
          <Row label="Operator strategy">
            <span style={{ color: 'var(--ed-steel-50)' }}>
              {operatorStrategy.strategy.id} · {operatorStrategy.strategy.type}
            </span>
          </Row>
        )}
        {hasPendingUpgrade && (
          <>
            <Row label="Pending hash">
              <code style={{ color: 'var(--ed-amber)' }}>
                {shortHexLabel(pendingManifestHash)}
              </code>
            </Row>
            <Row label="Timelock">
              <span
                className="inline-flex items-center gap-1"
                style={{ color: upgradeReady ? 'var(--ed-emerald)' : 'var(--ed-amber)' }}
              >
                <Hourglass size={12} />
                {countdownLabel}
              </span>
            </Row>
          </>
        )}
      </div>

      {isOwner && (
        <div className="mt-4 flex flex-wrap gap-2">
          {!hasPendingUpgrade && diff.reason === 'drift' && operatorHash && (
            <ControlButton
              variant="primary"
              disabled={requestPending}
              onClick={() => requestManifestUpgrade(vaultAddress, operatorHash)}
            >
              <RefreshCw size={14} />
              Request upgrade to operator's hash
            </ControlButton>
          )}
          {hasPendingUpgrade && upgradeReady && (
            <ControlButton
              variant="primary"
              disabled={applyPending}
              onClick={() => applyManifestUpgrade(vaultAddress)}
            >
              <CheckCircle size={14} />
              Apply pending upgrade
            </ControlButton>
          )}
          {hasPendingUpgrade && (
            <ControlButton
              variant="ghost"
              disabled={cancelPending}
              onClick={() => cancelManifestUpgrade(vaultAddress)}
            >
              <X size={14} />
              Cancel pending
            </ControlButton>
          )}
        </div>
      )}

      <p className="mt-4 text-[11px]" style={{ color: 'var(--ed-steel-300)' }}>
        V4 binds the strategy manifest hash on-chain. The orchestrator can only
        execute intents whose <code>strategyHash</code> matches the accepted
        commitment. Strategy changes go through a 24-hour timelock so a
        compromised operator cannot flip your vault onto a malicious manifest
        in the same block.
      </p>
    </section>
  );
}

function Row({ label, children }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-[10px] uppercase tracking-[0.14em]" style={{ color: 'var(--ed-steel-300)' }}>
        {label}
      </span>
      <span className="font-mono">{children}</span>
    </div>
  );
}

function DiffBadge({ diff }) {
  if (diff.match) {
    if (diff.reason === 'both-unbound') {
      return (
        <span
          className="px-2 py-1 rounded-full text-[10px] uppercase tracking-[0.16em] inline-flex items-center gap-1"
          style={{
            background: 'var(--ed-amber-bg)',
            color: 'var(--ed-amber)',
          }}
        >
          <AlertTriangle size={11} />
          Unbound
        </span>
      );
    }
    return (
      <span
        className="px-2 py-1 rounded-full text-[10px] uppercase tracking-[0.16em] inline-flex items-center gap-1"
        style={{
          background: 'var(--ed-emerald-bg)',
          color: 'var(--ed-emerald)',
        }}
      >
        <CheckCircle size={11} />
        Synced
      </span>
    );
  }
  if (diff.reason === 'no-operator-manifest') {
    return (
      <span
        className="px-2 py-1 rounded-full text-[10px] uppercase tracking-[0.16em] inline-flex items-center gap-1"
        style={{
          background: 'var(--ed-amber-bg)',
          color: 'var(--ed-amber)',
        }}
      >
        <AlertTriangle size={11} />
        Operator no manifest
      </span>
    );
  }
  if (diff.reason === 'unbound') {
    return (
      <span
        className="px-2 py-1 rounded-full text-[10px] uppercase tracking-[0.16em] inline-flex items-center gap-1"
        style={{
          background: 'var(--ed-amber-bg)',
          color: 'var(--ed-amber)',
        }}
      >
        <AlertTriangle size={11} />
        Vault unbound
      </span>
    );
  }
  // drift
  return (
    <span
      className="px-2 py-1 rounded-full text-[10px] uppercase tracking-[0.16em] inline-flex items-center gap-1"
      style={{
        background: 'var(--ed-rust-bg, rgba(255, 80, 60, 0.12))',
        color: 'var(--ed-rust, #ff5e3c)',
      }}
    >
      <AlertTriangle size={11} />
      Drift detected
    </span>
  );
}
