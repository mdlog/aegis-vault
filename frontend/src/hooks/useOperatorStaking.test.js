import { describe, it, expect } from 'vitest';
import {
  TIER_LABELS,
  TIER_THRESHOLDS,
  TIER_CAPS,
  formatVaultCap,
  nextTier,
  tierGapUsd,
} from './useOperatorStaking.js';

describe('useOperatorStaking helpers', () => {
  describe('TIER_LABELS', () => {
    it('maps every tier 0..4 to a label', () => {
      expect(TIER_LABELS[0]).toBe('None');
      expect(TIER_LABELS[1]).toBe('Bronze');
      expect(TIER_LABELS[2]).toBe('Silver');
      expect(TIER_LABELS[3]).toBe('Gold');
      expect(TIER_LABELS[4]).toBe('Platinum');
    });
  });

  describe('TIER_CAPS', () => {
    it('returns Infinity for Platinum', () => {
      expect(TIER_CAPS[4]).toBe(Infinity);
    });

    it('caps escalate monotonically', () => {
      expect(TIER_CAPS[0]).toBeLessThan(TIER_CAPS[1]);
      expect(TIER_CAPS[1]).toBeLessThan(TIER_CAPS[2]);
      expect(TIER_CAPS[2]).toBeLessThan(TIER_CAPS[3]);
      expect(TIER_CAPS[3]).toBeLessThan(TIER_CAPS[4]);
    });
  });

  describe('formatVaultCap', () => {
    it('returns Unlimited when isUnlimited flag is true', () => {
      expect(formatVaultCap(123_456, true)).toBe('Unlimited');
    });

    it('returns Unlimited when value is Infinity', () => {
      // This guards the bug we fixed: uint256.max formatted as parseFloat(formatUnits)
      // produces an enormous Number, which the helper must treat as Unlimited.
      expect(formatVaultCap(Infinity, false)).toBe('Unlimited');
    });

    it('formats millions with M suffix', () => {
      expect(formatVaultCap(5_000_000, false)).toBe('$5.0M');
      expect(formatVaultCap(1_500_000, false)).toBe('$1.5M');
    });

    it('formats thousands with k suffix', () => {
      expect(formatVaultCap(50_000, false)).toBe('$50k');
      expect(formatVaultCap(5_000, false)).toBe('$5k');
    });

    it('falls back to plain dollars below 1k', () => {
      expect(formatVaultCap(500, false)).toBe('$500');
    });
  });

  describe('nextTier', () => {
    it('returns null at Platinum (max)', () => {
      expect(nextTier(4)).toBeNull();
    });

    it('returns the next integer tier otherwise', () => {
      expect(nextTier(0)).toBe(1);
      expect(nextTier(1)).toBe(2);
      expect(nextTier(3)).toBe(4);
    });
  });

  describe('tierGapUsd', () => {
    it('returns 0 at Platinum', () => {
      expect(tierGapUsd(2_000_000, 4)).toBe(0);
    });

    it('returns the difference to the next threshold', () => {
      // Operator at $5k stake, currently None tier (cap $5k). Next tier is Bronze ($1k).
      // Already past Bronze threshold so gap is 0.
      expect(tierGapUsd(5_000, 0)).toBe(0);
      // Operator at $500 stake, None tier. Bronze needs $1k → gap = $500
      expect(tierGapUsd(500, 0)).toBe(500);
      // Operator at $50_000 stake, Silver tier (10k threshold). Gold needs 100k → gap = 50k
      expect(tierGapUsd(50_000, 2)).toBe(50_000);
    });

    it('never returns a negative gap', () => {
      // Even if you're way above the next threshold, gap is clamped to 0
      expect(tierGapUsd(2_000_000, 1)).toBe(0);
    });
  });

  describe('TIER_THRESHOLDS', () => {
    it('aligns with the contract constants', () => {
      expect(TIER_THRESHOLDS[1]).toBe(1_000);       // BRONZE_THRESHOLD
      expect(TIER_THRESHOLDS[2]).toBe(10_000);      // SILVER_THRESHOLD
      expect(TIER_THRESHOLDS[3]).toBe(100_000);     // GOLD_THRESHOLD
      expect(TIER_THRESHOLDS[4]).toBe(1_000_000);   // PLATINUM_THRESHOLD
    });
  });
});
