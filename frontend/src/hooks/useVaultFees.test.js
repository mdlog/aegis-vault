import { describe, it, expect } from 'vitest';
import { formatBps, estimateAnnualFees } from './useVaultFees.js';

describe('useVaultFees helpers', () => {
  describe('formatBps', () => {
    it('formats integer percentages', () => {
      expect(formatBps(1500)).toBe('15.00%');
      expect(formatBps(200)).toBe('2.00%');
      expect(formatBps(0)).toBe('0.00%');
    });

    it('handles fractional bps', () => {
      expect(formatBps(50)).toBe('0.50%');
      expect(formatBps(125)).toBe('1.25%');
    });

    it('returns dash for null/undefined', () => {
      expect(formatBps(null)).toBe('—');
      expect(formatBps(undefined)).toBe('—');
    });
  });

  describe('estimateAnnualFees', () => {
    it('computes management cost as % of NAV', () => {
      const result = estimateAnnualFees(100_000, 0, 200, 0); // 2% mgmt, 0% expected return
      expect(result.managementCost).toBe(2_000);
      expect(result.performanceCost).toBe(0);
      expect(result.totalEstimated).toBe(2_000);
    });

    it('computes performance cost as % of expected profit', () => {
      // 100k NAV, 15% perf fee, 10% expected return
      // Expected profit = 10k → perf = 1.5k
      const result = estimateAnnualFees(100_000, 1500, 0, 10);
      expect(result.performanceCost).toBe(1_500);
      expect(result.managementCost).toBe(0);
      expect(result.totalEstimated).toBe(1_500);
    });

    it('handles combined fees correctly', () => {
      // 50k NAV, 15% perf, 2% mgmt, 10% return
      // mgmt = 50000 * 0.02 = 1000
      // expected profit = 50000 * 0.10 = 5000 → perf = 5000 * 0.15 = 750
      const result = estimateAnnualFees(50_000, 1500, 200, 10);
      expect(result.managementCost).toBe(1_000);
      expect(result.performanceCost).toBe(750);
      expect(result.totalEstimated).toBe(1_750);
    });

    it('handles string NAV input', () => {
      const result = estimateAnnualFees('10000', 1500, 200, 10);
      expect(result.managementCost).toBe(200);
    });

    it('handles missing fees as zero', () => {
      const result = estimateAnnualFees(10_000, undefined, undefined, 10);
      expect(result.managementCost).toBe(0);
      expect(result.performanceCost).toBe(0);
    });

    it('handles zero NAV gracefully', () => {
      const result = estimateAnnualFees(0, 1500, 200, 10);
      expect(result.totalEstimated).toBe(0);
    });
  });
});
