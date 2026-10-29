export interface YouTubeVideo {
  id: string;
  startSeconds: number;
  url: string;
}

export function isYouTubeVideoId(value: string): boolean { return /^[A-Za-z0-9_-]{11}$/.test(value); }

function seconds(value: string | null): number | null {
  if (value === null || value === '') return 0;
  if (/^\d+(?:\.\d+)?s?$/.test(value)) return Number(value.replace(/s$/, ''));
  const clock = /^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+(?:\.\d+)?)s)?$/.exec(value);
  if (!clock || !clock.slice(1).some(Boolean)) return null;
  return Number(clock[1] ?? 0) * 3600 + Number(clock[2] ?? 0) * 60 + Number(clock[3] ?? 0);
}

export function youtubeVideoUrl(id: string, startSeconds = 0): string {
  if (!isYouTubeVideoId(id)) throw new Error('Use a valid YouTube video link.');
  const url = new URL('https://www.youtube.com/watch');
  url.searchParams.set('v', id);
  if (Number.isFinite(startSeconds) && startSeconds > 0 && startSeconds <= Number.MAX_SAFE_INTEGER) url.searchParams.set('t', `${startSeconds}s`);
  return url.href;
}

/** Only official single-video URLs are accepted. No redirects, arbitrary iframe URLs or playlists. */
export function parseYouTubeVideo(input: string): YouTubeVideo | null {
  try {
    const trimmed = input.trim();
    if (!trimmed || trimmed.length > 2048 || /[\u0000-\u0020\u007f]/.test(trimmed)) return null;
    const url = new URL(/^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`);
    if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password || url.port) return null;
    const host = url.hostname.toLowerCase();
    const main = ['youtube.com', 'www.youtube.com', 'm.youtube.com', 'music.youtube.com'].includes(host);
    const privacy = ['youtube-nocookie.com', 'www.youtube-nocookie.com'].includes(host);
    const parts = url.pathname.split('/').filter(Boolean);
    let id: string | null = null;
    if (host === 'youtu.be' && parts.length === 1) id = parts[0] ?? null;
    else if (main && url.pathname === '/watch' && url.searchParams.getAll('v').length === 1) id = url.searchParams.get('v');
    else if ((main || privacy) && parts.length === 2 && (privacy ? parts[0] === 'embed' : ['embed', 'shorts', 'live'].includes(parts[0] ?? ''))) id = parts[1] ?? null;
    if (!id || !isYouTubeVideoId(id)) return null;
    const queryTime = url.searchParams.get('t') ?? url.searchParams.get('start') ?? new URLSearchParams(url.hash.slice(1)).get('t');
    const startSeconds = seconds(queryTime);
    if (startSeconds === null || !Number.isFinite(startSeconds) || startSeconds < 0 || startSeconds > Number.MAX_SAFE_INTEGER) return null;
    return { id, startSeconds, url: youtubeVideoUrl(id, startSeconds) };
  } catch {
    return null;
  }
}
