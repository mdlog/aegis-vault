// @vitest-environment node
// Pure helper test. Runs in node env to dodge the repo's broken jsdom worker
// (html-encoding-sniffer/@exodus/bytes ESM-require incompatibility under Node 22).
import { describe, it, expect } from 'vitest';
import { teeBadgeState } from '../teeBadge.js';

describe('teeBadgeState', () => {
  it('verified only when teeVerified===true', () => {
    expect(teeBadgeState({ teeVerified: true, sealedMode: true })).toBe('verified');
  });
  it('sealed but not verified → unattested (never green)', () => {
    expect(teeBadgeState({ teeVerified: false, sealedMode: true })).toBe('unattested');
    expect(teeBadgeState({ sealedMode: true, attestationReportHash: '0xabc' })).toBe('unattested');
  });
  it('non-sealed → none', () => {
    expect(teeBadgeState({})).toBe('none');
  });
});
