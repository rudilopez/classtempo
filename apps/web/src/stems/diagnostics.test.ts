import { afterEach, describe, expect, it, vi } from 'vitest';
import { loadDiagnostic, saveDiagnostic, type RunDiagnostic } from './diagnostics';

afterEach(() => vi.unstubAllGlobals());

describe('stems run recovery', () => {
  it('recovers a running marker after a browser reload without claiming completion', () => {
    let stored = '';
    vi.stubGlobal('localStorage', {
      setItem: (_key: string, value: string) => { stored = value; },
      getItem: () => stored,
    });
    const diagnostic: RunDiagnostic = {
      schema: 1, status: 'running', stage: 'Separating chunk 3 of 41',
      updatedAt: '2026-10-22T00:00:00.000Z', elapsedMs: 12_000,
      requestedSeconds: 240, providerPreference: 'auto', userAgent: 'test', error: null,
    };
    saveDiagnostic(diagnostic);
    expect(loadDiagnostic()).toEqual(diagnostic);
  });

  it('tolerates unavailable storage and corrupted records', () => {
    vi.stubGlobal('localStorage', { getItem: () => { throw new Error('Unavailable'); } });
    expect(loadDiagnostic()).toBeNull();
    vi.stubGlobal('localStorage', { getItem: () => '{broken' });
    expect(loadDiagnostic()).toBeNull();
    vi.stubGlobal('localStorage', { getItem: () => '{"schema":1,"status":"completed"}' });
    expect(loadDiagnostic()).toBeNull();
  });
});
