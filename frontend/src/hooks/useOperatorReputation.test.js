import { describe, it, expect } from 'vitest';
import { reputationScore, formatPnl } from './useOperatorReputation.js';

describe('useOperatorReputation helpers', () => {
  describe('reputationScore', () => {
    it('returns 0 for null state', () => {
      expect(reputationScore(null)).toBe(0);
    });

    it('returns 0 for an operator with zero executions', () => {
      expect(reputationScore({
        totalExecutions: 0,
        successRatePct: 100,
        averageRating: 5,
        verified: true,
      })).toBe(0);
    });

    it('returns 100 for a perfect verified operator', () => {
      expect(reputationScore({
        totalExecutions: 50,
        successRatePct: 100,
        averageRating: 5,
        verified: true,
      })).toBe(100);
    });

    it('caps at 100 even when components would exceed', () => {
      const score = reputationScore({
        totalExecutions: 10,
        successRatePct: 100,    // 50
        averageRating: 5,        // 30
        verified: true,          // 20
      });
      expect(score).toBeLessThanOrEqual(100);
    });

    it('rewards verified status', () => {
      const unverified = reputationScore({
        totalExecutions: 10, successRatePct: 80, averageRating: 4, verified: false,
      });
      const verified = reputationScore({
        totalExecutions: 10, successRatePct: 80, averageRating: 4, verified: true,
      });
      expect(verified).toBe(unverified + 20);
    });

    it('penalizes low success rate', () => {
      const high = reputationScore({
        totalExecutions: 10, successRatePct: 90, averageRating: 4, verified: false,
      });
      const low = reputationScore({
        totalExecutions: 10, successRatePct: 30, averageRating: 4, verified: false,
      });
      expect(high).toBeGreaterThan(low);
    });

    it('returns an integer', () => {
      const score = reputationScore({
        totalExecutions: 7,
        successRatePct: 85.5,
        averageRating: 4.3,
        verified: false,
      });
      expect(Number.isInteger(score)).toBe(true);
    });
  });

  describe('formatPnl', () => {
    it('prepends + for positive values', () => {
      expect(formatPnl(1234)).toBe('+$1,234');
    });

    it('prepends + for zero', () => {
      expect(formatPnl(0)).toBe('+$0');
    });

    it('handles negative with no plus sign and abs value', () => {
      expect(formatPnl(-5678)).toBe('-$5,678');
    });

    it('rounds to whole dollars', () => {
      expect(formatPnl(1234.7)).toBe('+$1,235');
    });
  });
});
