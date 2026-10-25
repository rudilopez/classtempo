export interface AppleMusicConfig {
  developerToken: string;
  expiresAt: number;
}

/** Public developer credential only. The signing key and user token never belong in this file. */
export function parseAppleMusicConfig(value: unknown, now = Date.now() / 1000): AppleMusicConfig {
  if (!value || typeof value !== 'object') throw new Error('Apple Music setup is not available yet.');
  const candidate = value as Record<string, unknown>;
  if (typeof candidate.developerToken !== 'string' || !/^[\w-]+\.[\w-]+\.[\w-]+$/.test(candidate.developerToken)
    || typeof candidate.expiresAt !== 'number' || !Number.isFinite(candidate.expiresAt)) {
    throw new Error('Apple Music setup needs to be updated.');
  }
  if (candidate.expiresAt <= now + 60) throw new Error('Apple Music access needs to be renewed. Local files still work.');
  return { developerToken: candidate.developerToken, expiresAt: candidate.expiresAt };
}

export async function getAppleMusicConfig(signal?: AbortSignal): Promise<AppleMusicConfig> {
  const request = new AbortController();
  const cancel = () => request.abort();
  if (signal?.aborted) request.abort();
  signal?.addEventListener('abort', cancel, { once: true });
  const timeout = setTimeout(cancel, 15_000);
  try {
    let response: Response;
    try {
      response = await fetch(`${import.meta.env.BASE_URL}apple-music-config.json`, { cache: 'no-store', signal: request.signal });
    } catch {
      throw new Error('Connect to the internet to open Apple Music. Your saved local files still work offline.');
    }
    if (response.status === 404) throw new Error('Apple Music is awaiting developer account setup. It is not connected yet.');
    if (!response.ok) throw new Error('Apple Music setup is temporarily unavailable. Try again shortly.');
    let value: unknown;
    try { value = await response.json(); } catch { throw new Error('Apple Music setup is not available yet.'); }
    return parseAppleMusicConfig(value);
  } finally {
    clearTimeout(timeout);
    signal?.removeEventListener('abort', cancel);
  }
}
