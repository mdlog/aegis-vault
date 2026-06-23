import test from 'node:test';
import assert from 'node:assert/strict';
import { updatePnlMetrics } from '../src/services/orchestrator.js';

// Regression — AUDIT_MONEY_PATH.md Bug #2.
//
// updatePnlMetrics derives the off-chain daily-loss / rolling-drawdown signal
// (the ONLY daily-loss backstop, since the on-chain validator was removed) from
// the vault NAV. A capital flow (deposit/withdrawal) is detected via the
// totalDeposited delta. The bug: on any flow the baselines were REBASED to the
// current NAV, collapsing a genuine drawdown to ~0 and silently disarming the
// halt exactly when a depositor tops up an underwater vault. The fix shifts the
// baselines by the flow amount so the trading-loss signal survives the flow.

function makePosition() {
  return {
    daily_open_nav: null,
    peak_nav: null,
    last_total_deposited: null,
    daily_open_date: null,
    daily_pnl_pct: 0,
    rolling_drawdown_pct: 0,
  };
}

test('preserves the drawdown signal when a deposit arrives during a drawdown', () => {
  const ps = makePosition();

  // Cycle 1: seed at NAV 100, principal 100. No drawdown yet.
  updatePnlMetrics(ps, { nav: 100, totalDeposited: 100, currentDailyLossPct: 0 });
  assert.equal(ps.rolling_drawdown_pct, 0);

  // Cycle 2: trading loss, NAV 100 -> 95, no flow. Real 5% drawdown.
  const v2 = { nav: 95, totalDeposited: 100, currentDailyLossPct: 0 };
  updatePnlMetrics(ps, v2);
  assert.ok(Math.abs(ps.rolling_drawdown_pct - 5) < 1e-6, `expected ~5% drawdown, got ${ps.rolling_drawdown_pct}`);
  assert.ok(v2.currentDailyLossPct > 4, `expected daily loss > 4%, got ${v2.currentDailyLossPct}`);

  // Cycle 3: depositor tops up 50 while underwater. NAV 95 -> 145, principal 100 -> 150.
  // The deposit is NOT trading performance, so the ~5% trading loss must survive.
  const v3 = { nav: 145, totalDeposited: 150, currentDailyLossPct: 0 };
  updatePnlMetrics(ps, v3);

  // BUG: the old code rebased peak_nav/daily_open_nav to 145, making both of
  // these 0 and disarming the daily-loss / drawdown halt mid-drawdown.
  assert.ok(
    ps.rolling_drawdown_pct > 2,
    `deposit collapsed the drawdown signal to ${ps.rolling_drawdown_pct}% (halt disarmed mid-drawdown)`
  );
  assert.ok(
    v3.currentDailyLossPct > 0,
    `deposit zeroed the daily-loss signal (${v3.currentDailyLossPct}%)`
  );
});

test('does not introduce a false drawdown on a deposit made at the peak', () => {
  const ps = makePosition();

  // Seed at the peak (no drawdown).
  updatePnlMetrics(ps, { nav: 100, totalDeposited: 100, currentDailyLossPct: 0 });
  // Deposit 50 at the peak: NAV 100 -> 150, principal 100 -> 150. Still no loss.
  const v2 = { nav: 150, totalDeposited: 150, currentDailyLossPct: 0 };
  updatePnlMetrics(ps, v2);

  assert.ok(ps.rolling_drawdown_pct < 1e-6, `expected ~0 drawdown, got ${ps.rolling_drawdown_pct}`);
  assert.equal(v2.currentDailyLossPct, 0);
});
