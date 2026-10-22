import type { ProviderPreference } from './model';

const KEY = 'mixdeck.stems.spike.last-run.v1';

export interface RunDiagnostic {
  schema: 1;
  status: 'running' | 'failed' | 'cancelled' | 'completed';
  stage: string;
  updatedAt: string;
  elapsedMs: number;
  requestedSeconds: number;
  providerPreference: ProviderPreference;
  userAgent: string;
  error: string | null;
}

/** Store only test metadata, never audio or the chosen file name. */
export function saveDiagnostic(value: RunDiagnostic): void {
  try { localStorage.setItem(KEY, JSON.stringify(value)); } catch { /* Optional in private browsing. */ }
}

export function loadDiagnostic(): RunDiagnostic | null {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(KEY) ?? 'null');
    if (!value || typeof value !== 'object') return null;
    const record = value as Record<string, unknown>;
    if (record.schema !== 1 || !['running', 'failed', 'cancelled', 'completed'].includes(String(record.status)) ||
      typeof record.stage !== 'string' || typeof record.updatedAt !== 'string' ||
      typeof record.elapsedMs !== 'number' || typeof record.requestedSeconds !== 'number' ||
      typeof record.userAgent !== 'string' || !['auto', 'wasm'].includes(String(record.providerPreference)) ||
      (record.error !== null && typeof record.error !== 'string')) return null;
    return value as RunDiagnostic;
  } catch { return null; }
}
