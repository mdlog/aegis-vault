import { describe, expect, it } from 'vitest';
import {
  doesExecutorMatchOrchestrator,
  formatOrchestratorExecutorSummary,
  getOrchestratorExecutorAddresses,
  getPrimaryOrchestratorExecutor,
} from './orchestratorStatus';

describe('orchestratorStatus helpers', () => {
  it('prefers executorAddresses over the legacy single executor field', () => {
    const status = {
      executorAddress: '0x1111111111111111111111111111111111111111',
      executorAddresses: [
        '0x2222222222222222222222222222222222222222',
        '0x3333333333333333333333333333333333333333',
      ],
    };

    expect(getOrchestratorExecutorAddresses(status)).toEqual(status.executorAddresses);
    expect(getPrimaryOrchestratorExecutor(status)).toBe(status.executorAddresses[0]);
    expect(formatOrchestratorExecutorSummary(status)).toBe(
      '0x2222222222222222222222222222222222222222 (+1 more)'
    );
  });

  it('falls back to the legacy executorAddress field', () => {
    const status = {
      executorAddress: '0xAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
    };

    expect(getOrchestratorExecutorAddresses(status)).toEqual([
      '0xAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
    ]);
    expect(getPrimaryOrchestratorExecutor(status)).toBe(
      '0xAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA'
    );
    expect(formatOrchestratorExecutorSummary(status)).toBe(
      '0xAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA'
    );
  });

  it('matches executor addresses case-insensitively', () => {
    const status = {
      executorAddresses: [
        '0xFa5Cf1B466263Fdf5209Daa177f62E0dc8F310f0',
        '0x4E08B728087158a02aB458f03d833137b282eC5d',
      ],
    };

    expect(
      doesExecutorMatchOrchestrator(status, '0xfa5cf1b466263fdf5209daa177f62e0dc8f310f0')
    ).toBe(true);
    expect(
      doesExecutorMatchOrchestrator(status, '0x1111111111111111111111111111111111111111')
    ).toBe(false);
  });
});
