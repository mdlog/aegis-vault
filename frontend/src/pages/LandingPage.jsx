import { Link } from 'react-router-dom';
import {
  ArrowRight,
  Shield,
  Cpu,
  Zap,
  Lock,
  Vote,
  Target,
  Activity,
  Check,
  Circle,
  Network,
} from 'lucide-react';
import {
  AegisLogo,
  HeroShield,
  Eyebrow,
  LiveBadge,
  MonoKV,
} from '../components/editorial';
import Logo from '../components/ui/Logo';
import { useChainId } from 'wagmi';
import { getDeployments } from '../lib/contracts';
import { useAllPlatformVaults } from '../hooks/useVault';
import { useOperatorList } from '../hooks/useOperatorRegistry';
import { useOrchestratorStatus, useDecisions, usePlatformTVL } from '../hooks/useOrchestrator';

// ─────────────────────────────────────────────────────────────────────────────
// Landing stats — all real, all from the same hooks the app already uses. Any
// stat that has no data yet renders as "—" rather than a fake number, so the
// landing page reflects the real state of the deployment.
function useLandingStats() {
  const chainId = useChainId();
  const deployments = getDeployments(chainId);
  // V3 → V2 → V1 chain mirrors useVault / orchestrator config. Functionally the
  // hooks already aggregate across factory versions internally; we keep the
  // priority order here for readability so the stats source matches the
  // canonical V3 stack post-2026-04-27 fresh deploy.
  const factory =
    deployments.aegisVaultFactoryV3 ||
    deployments.aegisVaultFactoryV2 ||
    deployments.aegisVaultFactory;
  const registry = deployments.operatorRegistryV2 || deployments.operatorRegistry;

  const { vaults, total } = useAllPlatformVaults(factory);
  const { operators } = useOperatorList(registry);
  const { data: orchStatus } = useOrchestratorStatus();
  const { data: decisions } = useDecisions(100);

  const allVaultAddrs = (vaults || []).map((v) => v?.address).filter(Boolean);
  const { tvl } = usePlatformTVL(allVaultAddrs);

  const activeOperators = (operators || []).filter((op) => op?.loaded && op?.active).length;

  // Veto rate = share of AI decisions that hit hard_veto. Only shown once we
  // have enough decisions to be meaningful (≥10) — otherwise "—".
  const decisionSample = Array.isArray(decisions) ? decisions : [];
  const vetoCount = decisionSample.filter((d) => d?.hard_veto).length;
  const vetoRatePct = decisionSample.length >= 10
    ? (vetoCount / decisionSample.length) * 100
    : null;

  const executedActions = orchStatus?.totalExecutions ?? null;

  return {
    tvl,
    totalVaults: total,
    executedActions,
    vetoRatePct,
    activeOperators,
  };
}

function formatTvl(n) {
  if (!n || n <= 0) return '—';
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(n >= 10_000_000 ? 0 : 1)}M`;
  if (n >= 1_000) return `$${(n / 1_000).toFixed(n >= 10_000 ? 0 : 1)}K`;
  return `$${n.toFixed(0)}`;
}

function formatCount(n) {
  if (n == null) return '—';
  if (n === 0) return '0';
  return n.toLocaleString();
}

function formatPct(p) {
  if (p == null) return '—';
  return `${p.toFixed(1)}%`;
}

export default function LandingPage() {
  return (
    <div style={{ background: 'var(--ed-obsidian)', color: 'var(--ed-steel-50)' }} className="min-h-screen">
      <LandingNav />
      <LandingHero />
      <LandingTape />
      <LandingThesis />
      <LandingHowItWorks />
      <LandingCapabilities />
      <LandingArchitecture />
      <LandingTrust />
      <LandingCTA />
      <LandingFooter />
    </div>
  );
}

// ────────────── NAV ──────────────
function LandingNav() {
  return (
    <nav
      className="sticky top-0 z-50"
      style={{
        background: 'rgba(10,10,12,0.72)',
        backdropFilter: 'blur(14px)',
        borderBottom: '1px solid rgba(255,255,255,0.04)',
      }}
    >
      <div className="max-w-[1320px] mx-auto flex items-center gap-6 px-10 h-24">
        <Link to="/" className="flex items-center group">
          <Logo height={88} />
        </Link>
        <div className="ed-vhairline h-5 mx-1.5" />
        <div className="flex gap-0.5">
          {[
            { label: 'Thesis', href: '#thesis' },
            { label: 'Mechanism', href: '#mechanism' },
            { label: 'Architecture', href: '#architecture' },
            { label: 'Security', href: '#security' },
            { label: 'Docs', to: '/docs' },
          ].map((item) => {
            const shared = {
              key: item.label,
              className: 'px-3 py-2 text-[13px] rounded cursor-pointer transition-colors',
              style: { color: 'var(--ed-steel-300)' },
              onMouseEnter: (e) => (e.currentTarget.style.color = 'var(--ed-steel-50)'),
              onMouseLeave: (e) => (e.currentTarget.style.color = 'var(--ed-steel-300)'),
            };
            return item.to ? (
              <Link {...shared} to={item.to}>{item.label}</Link>
            ) : (
              <a {...shared} href={item.href}>{item.label}</a>
            );
          })}
        </div>
        <div className="flex-1" />
        <LiveBadge label="Live" subLabel="0G Mainnet" />
        <Link to="/whitepaper" className="ed-btn ed-btn-ghost ed-btn-sm cursor-pointer">
          Read whitepaper
        </Link>
        <Link to="/app" className="ed-btn ed-btn-gold ed-btn-sm">
          Launch app <ArrowRight size={14} />
        </Link>
      </div>
    </nav>
  );
}

// ────────────── HERO ──────────────
function LandingHero() {
  const stats = useLandingStats();
  return (
    <section className="relative overflow-hidden">
      <div
        className="ed-dotgrid absolute inset-0 opacity-60"
        style={{ maskImage: 'radial-gradient(ellipse at 60% 40%, black 30%, transparent 75%)' }}
      />
      <div
        className="absolute pointer-events-none"
        style={{
          top: -120,
          right: -60,
          width: 640,
          height: 640,
          background: 'radial-gradient(circle, rgba(201,168,76,0.08) 0%, transparent 60%)',
        }}
      />

      <div className="max-w-[1320px] mx-auto px-10 pt-24 pb-20 relative">
        <div className="grid items-center gap-14" style={{ gridTemplateColumns: '1.25fr 0.9fr' }}>
          {/* LEFT — headline */}
          <div>
            <div className="flex items-baseline gap-3.5 mb-8">
              <span className="ed-eyebrow">§ 01 · THESIS</span>
              <span
                className="ed-mono"
                style={{ fontSize: 10, color: 'var(--ed-steel-500)', letterSpacing: '0.18em' }}
              >
                VOL. 001 / TRACK 2 · 2026
              </span>
            </div>

            <h1
              className="ed-display"
              style={{
                fontSize: 96,
                lineHeight: 0.94,
                fontWeight: 500,
                letterSpacing: '-0.045em',
                margin: 0,
                color: 'var(--ed-steel-50)',
              }}
            >
              The AI<br />
              <span style={{ color: 'var(--ed-steel-400)' }}>manages.</span>
              <br />
              The vault,<br />
              <span className="ed-italic" style={{ fontWeight: 400, color: 'var(--ed-gold)' }}>
                refuses.
              </span>
            </h1>

            <p
              style={{
                fontSize: 18,
                lineHeight: 1.55,
                color: 'var(--ed-steel-300)',
                marginTop: 36,
                maxWidth: 560,
              }}
            >
              Aegis Vault is an autonomous risk-managed treasury on 0G. An AI agent proposes every move —
              policy-bounded smart contracts decide whether it happens. Each decision is receipted on-chain,
              each model-signature verifiable.{' '}
              <span className="ed-italic" style={{ color: 'var(--ed-steel-100)' }}>
                Discretion with evidence.
              </span>
            </p>

            <div className="flex items-center gap-3 mt-10">
              <Link to="/create" className="ed-btn ed-btn-gold" style={{ padding: '14px 22px', fontSize: 14 }}>
                Open a vault <ArrowRight size={16} />
              </Link>
              <Link to="/whitepaper" className="ed-btn ed-btn-ghost" style={{ padding: '14px 22px', fontSize: 14 }}>
                Read whitepaper
              </Link>
              <div className="ed-vhairline h-[26px] ml-2" />
              <div className="flex flex-col leading-tight">
                <span
                  className="ed-mono"
                  style={{ fontSize: 10, color: 'var(--ed-steel-500)', letterSpacing: '0.2em' }}
                >
                  TVL · LIVE
                </span>
                <span
                  className="ed-display"
                  style={{ fontSize: 18, color: 'var(--ed-steel-100)', fontWeight: 600 }}
                  title="Sum of NAV across all on-chain vaults, priced via Pyth"
                >
                  {formatTvl(stats.tvl)}
                </span>
              </div>
            </div>

            {/* Editorial meta row */}
            <div
              className="mt-14 grid"
              style={{
                gridTemplateColumns: 'repeat(4, 1fr)',
                borderTop: '1px solid rgba(255,255,255,0.06)',
                borderBottom: '1px solid rgba(255,255,255,0.06)',
                padding: '18px 0',
              }}
            >
              {[
                { k: 'Vaults', v: formatCount(stats.totalVaults) },
                { k: 'Executed actions', v: formatCount(stats.executedActions) },
                { k: 'Veto rate', v: formatPct(stats.vetoRatePct) },
                { k: 'Active operators', v: formatCount(stats.activeOperators) },
              ].map((m, i) => (
                <div
                  key={i}
                  style={{ paddingLeft: i ? 20 : 0, borderLeft: i ? '1px solid rgba(255,255,255,0.06)' : 'none' }}
                >
                  <div
                    className="ed-mono"
                    style={{ fontSize: 9, color: 'var(--ed-steel-500)', letterSpacing: '0.24em', marginBottom: 6 }}
                  >
                    {m.k.toUpperCase()}
                  </div>
                  <div
                    className="ed-display"
                    style={{ fontSize: 22, color: 'var(--ed-steel-100)', fontWeight: 600 }}
                  >
                    {m.v}
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* RIGHT — shield + live panel */}
          <div className="relative flex items-center justify-center">
            <div className="absolute inset-[-20px] flex items-center justify-center">
              <div
                style={{
                  width: 480,
                  height: 480,
                  borderRadius: '50%',
                  border: '1px dashed rgba(201,168,76,0.12)',
                }}
                className="flex items-center justify-center"
              >
                <div
                  style={{
                    width: 380,
                    height: 380,
                    borderRadius: '50%',
                    border: '1px solid rgba(255,255,255,0.04)',
                  }}
                />
              </div>
            </div>

            <HeroShield size={380} />

            {/* Floating readouts */}
            <div
              className="absolute"
              style={{
                top: 30,
                right: -10,
                background: 'var(--ed-surface-1)',
                padding: 14,
                borderRadius: 10,
                boxShadow: 'var(--ed-ghost-border)',
                width: 200,
              }}
            >
              <div className="flex justify-between items-center mb-2">
                <span
                  className="ed-mono"
                  style={{ fontSize: 9, color: 'var(--ed-gold)', letterSpacing: '0.2em' }}
                >
                  LAST DECISION
                </span>
                <span className="ed-live-dot" />
              </div>
              <div className="ed-italic" style={{ fontSize: 15, color: 'var(--ed-steel-100)', marginBottom: 6 }}>
                Trim BTC -12%
              </div>
              <div className="ed-mono" style={{ fontSize: 10, color: 'var(--ed-steel-400)' }}>
                confidence 0.78 · auto-execute
              </div>
              <div className="ed-hairline my-2" />
              <div className="ed-mono" style={{ fontSize: 10, color: 'var(--ed-steel-500)' }}>
                tx <span style={{ color: 'var(--ed-cyan)' }}>0x7f2a…c4e1</span>
              </div>
            </div>

            <div
              className="absolute"
              style={{
                bottom: 30,
                left: -20,
                background: 'var(--ed-surface-1)',
                padding: 14,
                borderRadius: 10,
                boxShadow: 'var(--ed-ghost-border)',
                width: 220,
              }}
            >
              <div
                className="ed-mono mb-2.5"
                style={{ fontSize: 9, color: 'var(--ed-cyan)', letterSpacing: '0.2em' }}
              >
                POLICY GATE
              </div>
              <div className="flex flex-col gap-1.5">
                {[
                  ['Max drawdown', '−8.4% / −15%', 'var(--ed-emerald)'],
                  ['Daily turnover', '22% / 40%', 'var(--ed-emerald)'],
                  ['Concentration', '38% / 50%', 'var(--ed-amber)'],
                ].map(([k, v, c]) => (
                  <div key={k} className="flex justify-between text-[11px]">
                    <span style={{ color: 'var(--ed-steel-400)' }}>{k}</span>
                    <span className="ed-mono" style={{ color: c }}>
                      {v}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

// ────────────── TAPE ──────────────
function LandingTape() {
  const items = [
    '0G COMPUTE · VERIFIED INFERENCE',
    'PYTH ORACLES · PRICE TRUTH',
    'EVM EQUIVALENT',
    'TEE ATTESTATION',
    'EIP-712 SIGNED INTENTS',
    '18 CONTRACTS · 0G MAINNET',
    'SEALED COMMIT-REVEAL',
    'OPERATOR STAKING + SLASHING',
  ];
  return (
    <section
      style={{
        borderTop: '1px solid rgba(255,255,255,0.05)',
        borderBottom: '1px solid rgba(255,255,255,0.05)',
        background: 'var(--ed-obsidian-dim)',
        overflow: 'hidden',
        padding: '20px 0',
      }}
    >
      <div className="ed-tape-scroll flex gap-12 whitespace-nowrap">
        {[...items, ...items, ...items].map((x, i) => (
          <div
            key={i}
            className="ed-mono"
            style={{ fontSize: 11, color: 'var(--ed-steel-500)', letterSpacing: '0.26em' }}
          >
            <span style={{ color: 'var(--ed-gold)', marginRight: 14 }}>✦</span>
            {x}
          </div>
        ))}
      </div>
    </section>
  );
}

// ────────────── THESIS ──────────────
function LandingThesis() {
  return (
    <section id="thesis" className="max-w-[1320px] mx-auto px-10 py-[120px] relative">
      <div className="ed-ghost-numeral absolute" style={{ left: 32, top: 64, fontSize: '10rem' }}>
        02
      </div>
      <div className="grid gap-20 relative" style={{ gridTemplateColumns: '1fr 1.2fr' }}>
        <div>
          <Eyebrow section="02" title="The problem" />
          <h2
            className="ed-display"
            style={{ fontSize: 58, lineHeight: 0.98, fontWeight: 500, letterSpacing: '-0.035em', margin: 0 }}
          >
            Every AI fund is a<br />
            <span className="ed-italic" style={{ fontWeight: 400, color: 'var(--ed-gold)' }}>
              trust exercise.
            </span>
          </h2>
          <p
            style={{
              fontSize: 16.5,
              lineHeight: 1.6,
              color: 'var(--ed-steel-300)',
              marginTop: 28,
              maxWidth: 480,
            }}
          >
            You cannot audit a black-box model. You cannot constrain a human manager after the trade.
            Aegis inverts the stack: the smart contract is the{' '}
            <span className="ed-italic-upright" style={{ color: 'var(--ed-steel-100)' }}>
              principal
            </span>
            , the AI is the{' '}
            <span className="ed-italic-upright" style={{ color: 'var(--ed-steel-100)' }}>
              advisor
            </span>
            , and every inference carries an attestation that survives adversarial review.
          </p>
        </div>

        <div className="flex flex-col gap-[18px]">
          {[
            {
              n: '01',
              q: 'Who decided this trade?',
              a: 'Model hash, operator, input state — all signed, on-chain, and replayable.',
            },
            {
              n: '02',
              q: 'What stopped the agent from rug-pulling?',
              a: 'Policy bounds enforced in Solidity: caps, allowlists, veto windows, signed commit-reveal. TEE attestation is DCAP-verified off-chain for opted-in vaults.',
            },
            {
              n: '03',
              q: 'How do I evaluate a strategy?',
              a: 'Actions are a public ledger. Sharpe, drawdown, veto rate — evidence, not claims.',
            },
          ].map((x, i) => (
            <div
              key={i}
              className="grid gap-[18px] py-[22px]"
              style={{ gridTemplateColumns: '64px 1fr', borderTop: '1px solid rgba(255,255,255,0.05)' }}
            >
              <span className="ed-italic" style={{ fontSize: 36, color: 'var(--ed-gold)', lineHeight: 1 }}>
                {x.n}
              </span>
              <div>
                <div
                  className="ed-display"
                  style={{ fontSize: 20, color: 'var(--ed-steel-100)', fontWeight: 500, marginBottom: 6 }}
                >
                  {x.q}
                </div>
                <p style={{ fontSize: 14, color: 'var(--ed-steel-400)', lineHeight: 1.55, margin: 0 }}>{x.a}</p>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

// ────────────── HOW IT WORKS ──────────────
function LandingHowItWorks() {
  const steps = [
    {
      n: '01',
      t: 'Operator signals',
      body:
        'A registered AI operator runs inference on 0G Compute. Output is signed with the model hash and bundled with inputs.',
      icon: <Cpu size={18} />,
      tone: 'cyan',
    },
    {
      n: '02',
      t: 'Policy gate evaluates',
      body:
        "The vault's Solidity policy checks bounds: turnover, drawdown, concentration, allowlist. A veto window opens for governance.",
      icon: <Shield size={18} />,
      tone: 'gold',
    },
    {
      n: '03',
      t: 'Execution or refusal',
      body:
        'If it passes, the action executes and mints a receipt. If it fails, the reason is logged — the AI cannot retry until the quorum clears.',
      icon: <Zap size={18} />,
      tone: 'emerald',
    },
  ];
  const toneColor = (t) => (t === 'cyan' ? 'var(--ed-cyan)' : t === 'gold' ? 'var(--ed-gold)' : 'var(--ed-emerald)');
  const toneRgb = (t) => (t === 'cyan' ? '76,201,240' : t === 'gold' ? '201,168,76' : '16,185,129');

  return (
    <section
      id="mechanism"
      style={{
        background: 'var(--ed-obsidian-dim)',
        borderTop: '1px solid rgba(255,255,255,0.05)',
        borderBottom: '1px solid rgba(255,255,255,0.05)',
      }}
    >
      <div className="max-w-[1320px] mx-auto px-10 py-[110px]">
        <div className="flex items-end justify-between mb-14">
          <div>
            <Eyebrow section="03" title="Mechanism" />
            <h2
              className="ed-display"
              style={{ fontSize: 54, fontWeight: 500, letterSpacing: '-0.035em', margin: 0, lineHeight: 1 }}
            >
              Three gates.<br />
              Every action.{' '}
              <span className="ed-italic" style={{ color: 'var(--ed-gold)' }}>
                Every time.
              </span>
            </h2>
          </div>
          <div style={{ maxWidth: 340 }}>
            <p style={{ fontSize: 14, color: 'var(--ed-steel-400)', lineHeight: 1.6, margin: 0 }}>
              The agent proposes, policy decides, the chain records. Three choreographed phases — not an opinion,
              not a heuristic; a protocol.
            </p>
          </div>
        </div>

        <div
          className="grid"
          style={{
            gridTemplateColumns: '1fr 1fr 1fr',
            border: '1px solid rgba(255,255,255,0.05)',
            borderRadius: 20,
            overflow: 'hidden',
          }}
        >
          {steps.map((s, i) => (
            <div
              key={i}
              style={{
                padding: 32,
                borderRight: i < 2 ? '1px solid rgba(255,255,255,0.05)' : 'none',
                background: 'var(--ed-surface-1)',
                position: 'relative',
              }}
            >
              <div className="flex items-center justify-between mb-7">
                <span
                  className="ed-italic"
                  style={{ fontSize: 46, color: toneColor(s.tone), opacity: 0.9, lineHeight: 1 }}
                >
                  {s.n}
                </span>
                <div
                  style={{
                    width: 40,
                    height: 40,
                    borderRadius: 10,
                    background: `rgba(${toneRgb(s.tone)},0.08)`,
                    color: toneColor(s.tone),
                    boxShadow: `inset 0 0 0 1px rgba(${toneRgb(s.tone)},0.25)`,
                  }}
                  className="flex items-center justify-center"
                >
                  {s.icon}
                </div>
              </div>
              <h3
                className="ed-display"
                style={{
                  fontSize: 22,
                  fontWeight: 600,
                  color: 'var(--ed-steel-50)',
                  margin: 0,
                  letterSpacing: '-0.02em',
                }}
              >
                {s.t}
              </h3>
              <p style={{ fontSize: 13.5, color: 'var(--ed-steel-400)', lineHeight: 1.6, marginTop: 12 }}>
                {s.body}
              </p>
              <div className="mt-5 pt-3" style={{ borderTop: '1px dashed rgba(255,255,255,0.06)' }}>
                {i === 0 && (
                  <>
                    <MonoKV k="INPUTS" v="OHLC · volume · funding" />
                    <MonoKV k="MODEL" v="GLM-5-FP8" color="var(--ed-cyan)" />
                    <MonoKV k="ATTEST" v="0g-compute · TEE" />
                  </>
                )}
                {i === 1 && (
                  <>
                    <MonoKV k="DRAWDOWN" v="−8.4% / −15%" color="var(--ed-emerald)" />
                    <MonoKV k="TURNOVER" v="22% / 40%" color="var(--ed-emerald)" />
                    <MonoKV k="VETO LEFT" v="01:42" color="var(--ed-amber)" />
                  </>
                )}
                {i === 2 && (
                  <>
                    <MonoKV k="TX" v="0x7f2a…c4e1" color="var(--ed-cyan)" />
                    <MonoKV k="GAS" v="0.8 gwei" />
                    <MonoKV k="RECEIPT" v="minted · #3481" color="var(--ed-gold)" />
                  </>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

// ────────────── CAPABILITIES ──────────────
function LandingCapabilities() {
  const caps = [
    { icon: <Lock size={16} />, t: 'Sealed mode', body: 'Private reasoning, public proof. Inference is committed on-chain; for attested vaults the provider TDX quote is DCAP-verified each cycle.' },
    { icon: <Network size={16} />, t: 'Cross-chain via Khalani', body: 'V3 vaults accept solver-fulfilled fills from Ethereum, Arbitrum, Base + native 0G — single-chain wallet, multi-chain liquidity. Per-vault fee cap sealed at create.' },
    { icon: <Vote size={16} />, t: 'Operator marketplace', body: 'Stake-weighted registry of model providers. Reputation is on-chain, bonded, permissionless to join. Slashing enforcement ships in Phase 2.' },
    { icon: <Cpu size={16} />, t: '0G Compute runtime', body: 'Distributed GPU inference with verifiable output. Every action references its compute receipt.' },
    { icon: <Shield size={16} />, t: 'Multi-sig governance', body: 'Treasury, insurance, and operator-freeze controls sit behind a k-of-n council with cooldown windows.' },
    { icon: <Target size={16} />, t: 'Policy presets', body: 'Conservative, Balanced, Tactical — or compose your own. Caps compile directly to the vault contract.' },
    { icon: <Activity size={16} />, t: 'Live execution ledger', body: "Every signal, veto, and trade is indexable. Bring your own observability; we don't hide the tape." },
  ];
  return (
    <section className="max-w-[1320px] mx-auto px-10 py-[110px]">
      <div className="grid gap-14 mb-12" style={{ gridTemplateColumns: '1fr 2fr' }}>
        <div>
          <Eyebrow section="04" title="Capabilities" />
          <h2
            className="ed-display"
            style={{ fontSize: 48, fontWeight: 500, letterSpacing: '-0.035em', margin: 0, lineHeight: 1 }}
          >
            Every part,<br />
            <span className="ed-italic" style={{ color: 'var(--ed-gold)' }}>
              load-bearing.
            </span>
          </h2>
        </div>
        <p
          style={{
            fontSize: 15,
            color: 'var(--ed-steel-300)',
            lineHeight: 1.6,
            maxWidth: 560,
            alignSelf: 'end',
            margin: 0,
          }}
        >
          Aegis is not a single contract with a wrapper. It is a suite of interlocking systems, each with its own
          security posture, each composable, each observable. Turn any module off and the rest degrade gracefully.
        </p>
      </div>

      <div className="grid gap-[18px]" style={{ gridTemplateColumns: 'repeat(3, 1fr)' }}>
        {caps.map((c, i) => (
          <div
            key={i}
            className="ed-card p-7 min-h-[200px] flex flex-col"
          >
            <div
              className="flex items-center justify-center mb-4"
              style={{
                width: 36,
                height: 36,
                borderRadius: 10,
                background: 'rgba(201,168,76,0.06)',
                color: 'var(--ed-gold)',
                boxShadow: 'inset 0 0 0 1px rgba(201,168,76,0.2)',
              }}
            >
              {c.icon}
            </div>
            <h3
              className="ed-display"
              style={{
                fontSize: 18,
                fontWeight: 600,
                margin: 0,
                color: 'var(--ed-steel-50)',
                letterSpacing: '-0.015em',
              }}
            >
              {c.t}
            </h3>
            <p style={{ fontSize: 13, color: 'var(--ed-steel-400)', lineHeight: 1.55, marginTop: 10, flex: 1 }}>
              {c.body}
            </p>
            <div
              className="ed-mono flex items-center gap-1.5 mt-3"
              style={{ color: 'var(--ed-gold)', fontSize: 11.5 }}
            >
              LEARN MORE <ArrowRight size={12} />
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

// ────────────── ARCHITECTURE ──────────────
function LandingArchitecture() {
  return (
    <section
      id="architecture"
      style={{
        background: 'var(--ed-obsidian-dim)',
        borderTop: '1px solid rgba(255,255,255,0.05)',
        borderBottom: '1px solid rgba(255,255,255,0.05)',
      }}
    >
      <div className="max-w-[1320px] mx-auto px-10 py-[110px]">
        <div className="grid gap-14 items-start" style={{ gridTemplateColumns: '0.8fr 1.4fr' }}>
          <div style={{ position: 'sticky', top: 120 }}>
            <Eyebrow section="05" title="Architecture" />
            <h2
              className="ed-display"
              style={{ fontSize: 48, fontWeight: 500, letterSpacing: '-0.035em', margin: 0, lineHeight: 1 }}
            >
              Four layers.<br />
              <span className="ed-italic" style={{ color: 'var(--ed-gold)' }}>
                Each one,
              </span>
              <br />
              <span className="ed-italic" style={{ color: 'var(--ed-gold)' }}>
                signable.
              </span>
            </h2>
            <p
              style={{
                fontSize: 14,
                color: 'var(--ed-steel-400)',
                lineHeight: 1.6,
                marginTop: 24,
                maxWidth: 320,
              }}
            >
              From raw market data to receipted action, every transformation is attestable and independently
              replayable.
            </p>

            <div className="ed-card mt-7 p-[18px]">
              <div
                className="ed-mono mb-2.5"
                style={{ fontSize: 9, color: 'var(--ed-gold)', letterSpacing: '0.2em' }}
              >
                DEPLOYMENT FOOTPRINT
              </div>
              <MonoKV k="AegisVaultFactory" v="0xE0…a683" color="var(--ed-cyan)" />
              <MonoKV k="OperatorRegistry" v="0x3D…37fe" color="var(--ed-cyan)" />
              <MonoKV k="AegisGovernor" v="0x33…F06E" color="var(--ed-cyan)" />
              <MonoKV k="SealedLib" v="0xe8…4D61" color="var(--ed-cyan)" />
            </div>
          </div>

          <ArchitectureDiagram />
        </div>
      </div>
    </section>
  );
}

function ArchitectureDiagram() {
  const layers = [
    {
      name: 'Intelligence',
      color: 'var(--ed-cyan)',
      bg: 'rgba(76,201,240,0.05)',
      border: 'rgba(76,201,240,0.22)',
      tag: 'L4',
      nodes: ['Operator Network', '0G Compute', 'Pyth Oracles'],
      caption: 'Signed inference + market truth',
    },
    {
      name: 'Policy',
      color: 'var(--ed-gold)',
      bg: 'rgba(201,168,76,0.05)',
      border: 'rgba(201,168,76,0.22)',
      tag: 'L3',
      nodes: ['Risk Bounds', 'Veto Window', 'Multi-sig Governor'],
      caption: 'Constraints compiled to Solidity',
    },
    {
      name: 'Execution',
      color: 'var(--ed-emerald)',
      bg: 'rgba(16,185,129,0.05)',
      border: 'rgba(16,185,129,0.22)',
      tag: 'L2',
      nodes: ['Vault Executor', 'DEX Adapters', 'Commit-Reveal'],
      caption: 'The only code that can move funds',
    },
    {
      name: 'Ledger',
      color: 'var(--ed-steel-300)',
      bg: 'rgba(255,255,255,0.02)',
      border: 'rgba(255,255,255,0.08)',
      tag: 'L1',
      nodes: ['Action Receipts', 'Attestation Store', '0G Storage'],
      caption: 'Public, replayable, permanent',
    },
  ];
  return (
    <div className="flex flex-col gap-3.5">
      {layers.map((L, i) => (
        <div
          key={i}
          style={{ background: L.bg, borderRadius: 14, padding: 22, boxShadow: `inset 0 0 0 1px ${L.border}` }}
        >
          <div className="flex items-center justify-between mb-3.5">
            <div className="flex items-baseline gap-3.5">
              <span
                className="ed-mono"
                style={{ fontSize: 10, color: L.color, letterSpacing: '0.22em' }}
              >
                {L.tag}
              </span>
              <h4
                className="ed-display"
                style={{
                  fontSize: 22,
                  margin: 0,
                  color: 'var(--ed-steel-50)',
                  letterSpacing: '-0.02em',
                  fontWeight: 600,
                }}
              >
                {L.name}
              </h4>
              <span className="ed-italic" style={{ fontSize: 14, color: 'var(--ed-steel-400)' }}>
                {L.caption}
              </span>
            </div>
            <span
              className="ed-mono"
              style={{ fontSize: 10, color: 'var(--ed-steel-500)', letterSpacing: '0.16em' }}
            >
              {L.nodes.length} MODULES
            </span>
          </div>
          <div className="grid gap-2.5" style={{ gridTemplateColumns: 'repeat(3, 1fr)' }}>
            {L.nodes.map((n, j) => (
              <div
                key={j}
                className="flex items-center justify-between"
                style={{
                  padding: '12px 14px',
                  background: 'rgba(0,0,0,0.24)',
                  borderRadius: 8,
                  boxShadow: `inset 0 0 0 1px ${L.border}`,
                }}
              >
                <span style={{ fontSize: 12.5, color: 'var(--ed-steel-100)', fontWeight: 500 }}>{n}</span>
                <span style={{ width: 6, height: 6, borderRadius: 50, background: L.color }} />
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

// ────────────── TRUST ──────────────
function LandingTrust() {
  return (
    <section id="security" className="max-w-[1320px] mx-auto px-10 py-[110px] relative">
      <div className="grid gap-20 items-start" style={{ gridTemplateColumns: '1.2fr 1fr' }}>
        <div>
          <Eyebrow section="06" title="Trust model" />
          <h2
            className="ed-display"
            style={{ fontSize: 54, fontWeight: 500, letterSpacing: '-0.035em', margin: 0, lineHeight: 0.98 }}
          >
            Don't trust.{' '}
            <span className="ed-italic" style={{ color: 'var(--ed-gold)' }}>
              Verify.
            </span>
            <br />
            Then trust anyway —<br />
            the contract does.
          </h2>
          <div className="ed-hairline my-8" />
          <div className="grid grid-cols-2 gap-y-7 gap-x-10">
            {[
              { k: 'EIP-712 hash parity', v: 'Orchestrator ↔ Solidity' },
              { k: 'Test coverage', v: '28/28 green · slim build' },
              { k: 'TEE attestation', v: '0G Compute providers' },
              { k: 'Slashing', v: 'Operator stake · governance' },
            ].map((x, i) => (
              <div key={i}>
                <div
                  className="ed-mono mb-1.5"
                  style={{ fontSize: 10, color: 'var(--ed-steel-500)', letterSpacing: '0.18em' }}
                >
                  {x.k.toUpperCase()}
                </div>
                <div
                  className="ed-display"
                  style={{ fontSize: 18, color: 'var(--ed-steel-100)', fontWeight: 600 }}
                >
                  {x.v}
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Pull quote */}
        <div
          className="ed-card relative"
          style={{
            padding: '40px 36px',
            boxShadow: 'var(--ed-ghost-border-gold)',
          }}
        >
          <span
            className="ed-italic absolute"
            style={{ top: 20, left: 28, fontSize: 80, color: 'var(--ed-gold)', opacity: 0.5, lineHeight: 1 }}
          >
            "
          </span>
          <p
            className="ed-italic"
            style={{ fontSize: 24, color: 'var(--ed-steel-100)', lineHeight: 1.4, marginTop: 40, marginBottom: 28 }}
          >
            Traditional funds ask you to trust the manager. Aegis asks you to read the policy contract.
            Its discretion ends where the Solidity begins — and that is a product surface, not a marketing claim.
          </p>
          <div className="ed-hairline mb-4" />
          <div className="flex items-center gap-3">
            <div
              style={{
                width: 36,
                height: 36,
                borderRadius: 10,
                background: 'var(--ed-surface-3)',
                boxShadow: 'var(--ed-ghost-border)',
              }}
            />
            <div>
              <div
                className="ed-display"
                style={{ fontSize: 14, fontWeight: 600, color: 'var(--ed-steel-100)' }}
              >
                Aegis Foundation
              </div>
              <div
                className="ed-mono mt-0.5"
                style={{ fontSize: 10, color: 'var(--ed-steel-500)', letterSpacing: '0.14em' }}
              >
                TRACK 2 · AGENTIC TRADING ARENA
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

// ────────────── CLOSING CTA ──────────────
function LandingCTA() {
  return (
    <section
      className="relative overflow-hidden"
      style={{ background: 'var(--ed-obsidian-dim)', borderTop: '1px solid rgba(255,255,255,0.05)' }}
    >
      <div
        className="absolute inset-0"
        style={{ backgroundImage: 'radial-gradient(circle at 20% 50%, rgba(201,168,76,0.08), transparent 50%)' }}
      />
      <div
        className="max-w-[1320px] mx-auto px-10 py-[110px] relative grid items-center gap-20"
        style={{ gridTemplateColumns: '1.3fr 1fr' }}
      >
        <div>
          <Eyebrow section="07" title="Begin" />
          <h2
            className="ed-display"
            style={{ fontSize: 74, fontWeight: 500, letterSpacing: '-0.04em', margin: 0, lineHeight: 0.96 }}
          >
            Run a vault<br />
            <span className="ed-italic" style={{ color: 'var(--ed-gold)' }}>
              the contract
            </span>
            <br />
            would recognize.
          </h2>
          <p
            style={{
              fontSize: 16,
              color: 'var(--ed-steel-300)',
              lineHeight: 1.6,
              marginTop: 28,
              maxWidth: 520,
            }}
          >
            Six steps. Thirty seconds. Connect, pick a mandate, set policy bounds, choose your operator — the vault
            ships as a minimal proxy with your policy pre-compiled.
          </p>
          <div className="flex gap-3 mt-9">
            <Link to="/create" className="ed-btn ed-btn-gold" style={{ padding: '16px 28px', fontSize: 15 }}>
              Open a vault <ArrowRight size={16} />
            </Link>
            <Link to="/docs" className="ed-btn ed-btn-ghost" style={{ padding: '16px 28px', fontSize: 15 }}>
              Read the policy primer
            </Link>
          </div>
        </div>

        <div className="ed-card p-8">
          <div
            className="ed-mono mb-5"
            style={{ fontSize: 10, color: 'var(--ed-gold)', letterSpacing: '0.2em' }}
          >
            CREATE — 6 STEPS
          </div>
          {['Connect wallet', 'Deposit', 'Risk profile', 'Policy', 'Allowed assets', 'Seal & deploy'].map((s, i) => (
            <div
              key={i}
              className="flex items-center gap-3.5 py-3"
              style={{ borderTop: i ? '1px solid rgba(255,255,255,0.05)' : 'none' }}
            >
              <span
                className="ed-mono"
                style={{ fontSize: 10, color: 'var(--ed-steel-500)', letterSpacing: '0.16em', width: 18 }}
              >
                0{i + 1}
              </span>
              <span className="flex-1 text-[14px]" style={{ color: 'var(--ed-steel-100)' }}>{s}</span>
              {i < 3 ? <Check size={14} color="var(--ed-emerald)" /> : <Circle size={12} color="var(--ed-steel-500)" />}
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

// ────────────── FOOTER ──────────────
function LandingFooter() {
  return (
    <footer style={{ borderTop: '1px solid rgba(255,255,255,0.06)', padding: '48px 40px 36px' }}>
      <div className="max-w-[1320px] mx-auto grid gap-10" style={{ gridTemplateColumns: '1.5fr 1fr 1fr 1fr' }}>
        <div>
          <AegisLogo size={24} />
          <p
            style={{
              fontSize: 12.5,
              color: 'var(--ed-steel-400)',
              lineHeight: 1.6,
              marginTop: 18,
              maxWidth: 300,
            }}
          >
            Verifiable AI risk management on 0G. The AI proposes. The vault decides. Everything else is evidence.
          </p>
          <div className="flex gap-2 mt-4">
            {[
              { label: 'GH', href: 'https://github.com/mdlog/aegis-vault', title: 'GitHub' },
              { label: 'TW', href: null, title: 'X / Twitter · coming soon' },
              { label: 'DC', href: null, title: 'Discord · coming soon' },
              { label: 'TG', href: null, title: 'Telegram · coming soon' },
            ].map((s) => {
              const base = {
                width: 30,
                height: 30,
                borderRadius: 8,
                background: 'var(--ed-surface-1)',
                boxShadow: 'var(--ed-ghost-border)',
                fontSize: 10,
                color: s.href ? 'var(--ed-steel-300)' : 'var(--ed-steel-600)',
                cursor: s.href ? 'pointer' : 'default',
                opacity: s.href ? 1 : 0.5,
                textDecoration: 'none',
              };
              return s.href ? (
                <a
                  key={s.label}
                  href={s.href}
                  target="_blank"
                  rel="noreferrer"
                  title={s.title}
                  className="ed-mono flex items-center justify-center"
                  style={base}
                >
                  {s.label}
                </a>
              ) : (
                <span
                  key={s.label}
                  title={s.title}
                  className="ed-mono flex items-center justify-center"
                  style={base}
                >
                  {s.label}
                </span>
              );
            })}
          </div>
        </div>
        {[
          {
            t: 'Product',
            l: [
              { label: 'Overview', to: '/app' },
              { label: 'Vaults', to: '/app' },
              { label: 'Operators', to: '/marketplace' },
              { label: 'Governance', to: '/governance' },
              { label: 'Faucet', to: '/faucet' },
            ],
          },
          {
            t: 'Developers',
            l: [
              { label: 'Docs', to: '/docs' },
              { label: 'Contracts', to: '/docs#contracts' },
              { label: 'API', to: '/docs#api' },
              { label: 'Whitepaper', to: '/whitepaper' },
              { label: 'GitHub', href: 'https://github.com/mdlog/aegis-vault' },
            ],
          },
          {
            t: 'Security',
            l: [
              { label: 'Trust model', to: '/docs#trust-model' },
              { label: 'Architecture', to: '/docs#architecture' },
            ],
          },
        ].map((c, i) => (
          <div key={i}>
            <div
              className="ed-mono mb-4"
              style={{ fontSize: 10, color: 'var(--ed-gold)', letterSpacing: '0.22em' }}
            >
              {c.t.toUpperCase()}
            </div>
            <div className="flex flex-col gap-2.5">
              {c.l.map((x) => {
                const base = {
                  key: x.label,
                  className: 'cursor-pointer hover:text-white transition-colors',
                  style: { fontSize: 13, color: 'var(--ed-steel-300)' },
                };
                return x.to ? (
                  <Link {...base} to={x.to}>{x.label}</Link>
                ) : (
                  <a {...base} href={x.href} target="_blank" rel="noopener noreferrer">{x.label}</a>
                );
              })}
            </div>
          </div>
        ))}
      </div>
      <div className="ed-hairline my-10" />
      <div
        className="max-w-[1320px] mx-auto flex justify-between items-center"
        style={{ fontSize: 11 }}
      >
        <span
          className="ed-mono"
          style={{ color: 'var(--ed-steel-500)', letterSpacing: '0.14em' }}
        >
          © 2026 AEGIS · BUILT ON 0G · TRACK 2 SUBMISSION
        </span>
        <span
          className="ed-mono"
          style={{ color: 'var(--ed-steel-500)', letterSpacing: '0.14em' }}
        >
          VERSION 2.0 · COMMIT 24623da
        </span>
      </div>
    </footer>
  );
}
