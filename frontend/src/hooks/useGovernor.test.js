import { describe, it, expect } from 'vitest';
import { ProposalBuilders, decodeProposalAction, shortHex } from './useGovernor.js';

const STAKING = '0x1111111111111111111111111111111111111111';
const INSURANCE = '0x2222222222222222222222222222222222222222';
const TREASURY = '0x3333333333333333333333333333333333333333';
const REPUTATION = '0x4444444444444444444444444444444444444444';
const GOVERNOR = '0x5555555555555555555555555555555555555555';
const TOKEN = '0x6666666666666666666666666666666666666666';
const OPERATOR = '0x7777777777777777777777777777777777777777';
const RECIPIENT = '0x8888888888888888888888888888888888888888';

describe('ProposalBuilders', () => {
  describe('slash', () => {
    it('returns the correct target + nonzero data', () => {
      const built = ProposalBuilders.slash(STAKING, OPERATOR, '20000', 'reason');
      expect(built.target).toBe(STAKING);
      expect(built.value).toBe(0n);
      expect(typeof built.data).toBe('string');
      expect(built.data.startsWith('0x')).toBe(true);
      // The encoded calldata is the function selector (4 bytes = 8 hex) plus 3 args
      expect(built.data.length).toBeGreaterThan(10);
    });
  });

  describe('freeze / unfreeze', () => {
    it('encodes freeze with operator address', () => {
      const built = ProposalBuilders.freeze(STAKING, OPERATOR);
      expect(built.target).toBe(STAKING);
      expect(built.data).toMatch(/^0x[0-9a-f]+$/i);
    });

    it('encodes unfreeze with operator address', () => {
      const built = ProposalBuilders.unfreeze(STAKING, OPERATOR);
      expect(built.target).toBe(STAKING);
      expect(built.data).toMatch(/^0x[0-9a-f]+$/i);
    });
  });

  describe('payoutClaim', () => {
    it('encodes claim id + amount', () => {
      const built = ProposalBuilders.payoutClaim(INSURANCE, 1, '15000');
      expect(built.target).toBe(INSURANCE);
      expect(built.value).toBe(0n);
      expect(built.data).toMatch(/^0x[0-9a-f]+$/i);
    });

    it('coerces string claim id', () => {
      const built = ProposalBuilders.payoutClaim(INSURANCE, '42', '1000');
      expect(built.target).toBe(INSURANCE);
    });
  });

  describe('treasurySpend', () => {
    it('encodes token + recipient + amount + purpose', () => {
      const built = ProposalBuilders.treasurySpend(TREASURY, TOKEN, RECIPIENT, '5000', 'audit_grant');
      expect(built.target).toBe(TREASURY);
      expect(built.data.length).toBeGreaterThan(10);
    });
  });

  describe('setVerified', () => {
    it('encodes operator + verified bool', () => {
      const grant = ProposalBuilders.setVerified(REPUTATION, OPERATOR, true);
      const revoke = ProposalBuilders.setVerified(REPUTATION, OPERATOR, false);
      expect(grant.target).toBe(REPUTATION);
      expect(revoke.target).toBe(REPUTATION);
      // Different bool → different calldata
      expect(grant.data).not.toBe(revoke.data);
    });
  });

  describe('addOwner / removeOwner / changeThreshold', () => {
    it('all target the governor itself (self-call pattern)', () => {
      expect(ProposalBuilders.addOwner(GOVERNOR, OPERATOR).target).toBe(GOVERNOR);
      expect(ProposalBuilders.removeOwner(GOVERNOR, OPERATOR).target).toBe(GOVERNOR);
      expect(ProposalBuilders.changeThreshold(GOVERNOR, 3).target).toBe(GOVERNOR);
    });
  });
});

describe('decodeProposalAction', () => {
  const known = {
    operatorStaking: STAKING,
    insurancePool: INSURANCE,
    protocolTreasury: TREASURY,
    operatorReputation: REPUTATION,
    aegisGovernor: GOVERNOR,
  };

  it('labels each known target correctly', () => {
    expect(decodeProposalAction({ target: STAKING }, known)).toBe('Operator Staking');
    expect(decodeProposalAction({ target: INSURANCE }, known)).toBe('Insurance Pool');
    expect(decodeProposalAction({ target: TREASURY }, known)).toBe('Protocol Treasury');
    expect(decodeProposalAction({ target: REPUTATION }, known)).toBe('Reputation');
    expect(decodeProposalAction({ target: GOVERNOR }, known)).toBe('Governor (self)');
  });

  it('falls back to External for unknown targets', () => {
    expect(decodeProposalAction({ target: '0x9999999999999999999999999999999999999999' }, known))
      .toBe('External');
  });

  it('returns Unknown for missing proposal/target', () => {
    expect(decodeProposalAction(null, known)).toBe('Unknown');
    expect(decodeProposalAction({}, known)).toBe('Unknown');
  });

  it('is case-insensitive', () => {
    expect(decodeProposalAction({ target: STAKING.toUpperCase() }, known)).toBe('Operator Staking');
  });
});

describe('shortHex', () => {
  it('shortens an address with default lengths', () => {
    expect(shortHex('0x1234567890abcdef1234567890abcdef12345678'))
      .toBe('0x1234...5678');
  });

  it('respects custom lengths', () => {
    expect(shortHex('0x1234567890abcdef1234567890abcdef12345678', 10, 6))
      .toBe('0x12345678...345678');
  });

  it('returns empty string for falsy input', () => {
    expect(shortHex(null)).toBe('');
    expect(shortHex('')).toBe('');
  });
});
