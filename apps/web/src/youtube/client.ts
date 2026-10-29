import { isYouTubeVideoId, parseYouTubeVideo, type YouTubeVideo } from './video';

export interface YouTubeSnapshot {
  ready: boolean;
  videoId: string | null;
  title: string;
  duration: number;
  position: number;
  playing: boolean;
  rate: number;
  rates: number[];
  blocked: boolean;
}

export interface YouTubePlayer {
  cue(id: string, startSeconds?: number): void;
  play(): void;
  pause(): void;
  seek(seconds: number, wasPlaying: boolean): void;
  setRate(rate: number): void;
  snapshot(): YouTubeSnapshot;
  dispose(): void;
}

interface NativePlayer {
  cueVideoById(options: { videoId: string; startSeconds: number }): void;
  playVideo(): void;
  pauseVideo(): void;
  seekTo(seconds: number, allowSeekAhead: boolean): void;
  setPlaybackRate(rate: number): void;
  getPlaybackRate(): number;
  getAvailablePlaybackRates(): number[];
  getCurrentTime(): number;
  getDuration(): number;
  getPlayerState(): number;
  getVideoUrl(): string;
  getIframe(): HTMLIFrameElement;
  destroy(): void;
}
interface NativeEvent { target: NativePlayer; data?: number }
interface PlayerOptions {
  width?: string;
  height?: string;
  videoId?: string;
  playerVars?: { controls: number; playsinline: number; autoplay: number; origin: string; enablejsapi: number; start?: number };
  events: Record<'onReady' | 'onStateChange' | 'onPlaybackRateChange' | 'onError' | 'onAutoplayBlocked', (event: NativeEvent) => void>;
}
interface YouTubeApi { Player: new (host: HTMLElement, options: PlayerOptions) => NativePlayer }
type YouTubeGlobal = typeof globalThis & { YT?: YouTubeApi; onYouTubeIframeAPIReady?: () => void };
const browser = globalThis as YouTubeGlobal;
const TIMEOUT = 20_000;
let apiFlight: Promise<YouTubeApi> | null = null;

function cancelled(): DOMException { return new DOMException('YouTube opening cancelled.', 'AbortError'); }
function validApi(): YouTubeApi | null { return typeof browser.YT?.Player === 'function' ? browser.YT : null; }

/** Importing this module never contacts YouTube. Only an explicit video Open calls this loader. */
function loadApi(): Promise<YouTubeApi> {
  const existing = validApi();
  if (existing) return Promise.resolve(existing);
  if (apiFlight) return apiFlight;
  const flight = new Promise<YouTubeApi>((resolve, reject) => {
    const script = document.createElement('script');
    const previous = browser.onYouTubeIframeAPIReady;
    let settled = false;
    const done = (error?: Error) => {
      if (settled) return;
      const api = validApi();
      if (!error && !api) return;
      settled = true; clearTimeout(timer); script.removeEventListener('error', failed);
      if (browser.onYouTubeIframeAPIReady === ready) browser.onYouTubeIframeAPIReady = previous;
      if (error) { script.remove(); reject(error); } else resolve(api!);
    };
    const ready = () => { try { previous?.(); } catch { /* Another embed observer cannot block this player. */ } done(); };
    const failed = () => done(new Error('YouTube could not load. Check your connection or content blocker, then try again.'));
    const timer = setTimeout(failed, TIMEOUT);
    browser.onYouTubeIframeAPIReady = ready;
    script.src = 'https://www.youtube.com/iframe_api';
    script.async = true;
    script.referrerPolicy = 'strict-origin-when-cross-origin';
    script.addEventListener('error', failed);
    try { document.head.appendChild(script); } catch { failed(); }
  });
  apiFlight = flight;
  void flight.catch(() => { if (apiFlight === flight) apiFlight = null; });
  return flight;
}

function waitForApi(signal?: AbortSignal): Promise<YouTubeApi> {
  if (!signal) return loadApi();
  if (signal.aborted) return Promise.reject(cancelled());
  return new Promise((resolve, reject) => {
    const abort = () => { signal.removeEventListener('abort', abort); reject(cancelled()); };
    signal.addEventListener('abort', abort, { once: true });
    void loadApi().then(
      api => { signal.removeEventListener('abort', abort); if (signal.aborted) reject(cancelled()); else resolve(api); },
      error => { signal.removeEventListener('abort', abort); reject(error); },
    );
  });
}

function finite(value: number, fallback = 0): number { return Number.isFinite(value) ? value : fallback; }
function rates(values: number[]): number[] { return [...new Set(values.filter(value => Number.isFinite(value) && value >= 0.25 && value <= 4))].sort((a, b) => a - b); }
function iframeTitle(player: NativePlayer): string {
  try {
    const value = player.getIframe().title;
    const title = typeof value === 'string' ? value.replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, 250) : '';
    return title.toLowerCase() === 'youtube video player' ? '' : title;
  } catch { return ''; } // Optional DOM metadata must not disable transport.
}

function errorMessage(code?: number): string {
  if (code === 2) return 'This YouTube link is invalid. Paste a single video link and try again.';
  if (code === 100) return 'This video is private, removed or unavailable. Open another YouTube link.';
  if (code === 101 || code === 150) return 'The owner does not allow this video to play here. Use Open on YouTube or choose another video.';
  if (code === 153) return 'YouTube could not identify this browser page. Reload ClassTempo, or use Open on YouTube.';
  return 'YouTube could not play this video. Try again or use Open on YouTube.';
}

export async function createYouTubePlayer(
  host: HTMLElement, onSnapshot: (snapshot: YouTubeSnapshot) => void, onError: (message: string) => void,
  signal?: AbortSignal,
  initialVideo?: Pick<YouTubeVideo, 'id' | 'startSeconds'>,
): Promise<YouTubePlayer> {
  if (initialVideo && !isYouTubeVideoId(initialVideo.id)) throw new Error('Use a valid YouTube video link.');
  if (signal?.aborted) throw cancelled();
  const api = await waitForApi(signal);
  if (signal?.aborted) throw cancelled();
  return new Promise<YouTubePlayer>((resolve, reject) => {
    let native: NativePlayer | null = null;
    let disposed = false;
    let settled = false;
    let poll: ReturnType<typeof setInterval> | undefined;
    let expectedId: string | null = initialVideo?.id ?? null;
    let prepared: number | null = initialVideo ? Math.min(Number.MAX_SAFE_INTEGER, Math.max(0, finite(initialVideo.startSeconds))) : null;
    let preserveRate = 1;
    let pausePending = false;
    let unexpectedId: string | null = null;
    let state: YouTubeSnapshot = { ready: false, videoId: expectedId, title: '', duration: 0, position: prepared ?? 0, playing: false, rate: 1, rates: [1], blocked: false };
    // The documented existing-iframe constructor preserves YouTube's privacy-enhanced embed host.
    // Configure referrer and controls before insertion, so even the initial request identifies this app.
    const placeholder = initialVideo ? document.createElement('iframe') : document.createElement('div');
    if (initialVideo) {
      const iframe = placeholder as HTMLIFrameElement;
      const url = new URL(`https://www.youtube-nocookie.com/embed/${initialVideo.id}`);
      url.search = new URLSearchParams({ controls: '1', playsinline: '1', autoplay: '0', enablejsapi: '1',
        origin: location.origin, start: String(Math.floor(prepared ?? 0)), }).toString();
      iframe.referrerPolicy = 'strict-origin-when-cross-origin';
      iframe.title = 'YouTube video player'; iframe.width = '100%'; iframe.height = '100%';
      iframe.allow = 'autoplay; encrypted-media; picture-in-picture; fullscreen'; iframe.allowFullscreen = true;
      iframe.src = url.href;
    }
    host.appendChild(placeholder);
    const emit = () => {
      if (disposed) return;
      try { onSnapshot({ ...state, rates: [...state.rates] }); } catch { /* A view observer cannot interrupt owned player cleanup. */ }
    };
    const reportError = (message: string) => { try { onError(message); } catch { /* Keep cleanup independent from a view observer. */ } };
    const quietPause = () => { try { native?.pauseVideo(); } catch { /* Cleanup is best effort. */ } };
    const cleanup = () => {
      if (disposed) return;
      disposed = true; state.ready = false; state.playing = false;
      clearTimeout(timer); clearInterval(poll); signal?.removeEventListener('abort', abort);
      quietPause(); try { native?.destroy(); } catch { /* Unload may already have removed the iframe. */ }
      placeholder.remove();
    };
    const fail = (message: string) => {
      if (disposed) return;
      if (!settled) { settled = true; cleanup(); reject(new Error(message)); }
      else { pausePending = true; quietPause(); state.playing = false; emit(); reportError(message); }
    };
    const abort = () => { if (settled) return; settled = true; cleanup(); reject(cancelled()); };
    const timer = setTimeout(() => fail('YouTube did not finish opening. Check your connection, then try again.'), TIMEOUT);
    const read = (eventState?: number) => {
      if (disposed || !native || !state.ready) return;
      try {
        const actualId = parseYouTubeVideo(native.getVideoUrl())?.id ?? null;
        const status = eventState ?? native.getPlayerState();
        if (expectedId && actualId && actualId !== expectedId) {
          if (status === 1) {
            pausePending = true; quietPause(); state.playing = false; emit();
            if (unexpectedId !== actualId) { unexpectedId = actualId; reportError('Open the new video’s YouTube link in ClassTempo to use its own cues and controls.'); }
          }
          return;
        }
        unexpectedId = null;
        if (pausePending && status === 1) { quietPause(); return; }
        if (status === 2 || status === 5 || status === 0) pausePending = false;
        const duration = Math.min(Number.MAX_SAFE_INTEGER, Math.max(0, finite(native.getDuration())));
        const position = Math.max(0, finite(native.getCurrentTime()));
        // Native YouTube controls may start/seek somewhere else; their observed playing clock wins.
        if (status === 1) prepared = null;
        const available = rates(native.getAvailablePlaybackRates());
        state = { ...state, videoId: expectedId ?? actualId, title: iframeTitle(native),
          duration, position: Math.min(duration || Infinity, prepared ?? position), playing: status === 1, blocked: status === 1 ? false : state.blocked,
          rate: Math.max(0.25, finite(native.getPlaybackRate(), 1)), rates: available.length ? available : [1] };
        emit();
      } catch { fail('YouTube stopped responding. Open the video again to continue.'); }
    };
    const available = (): NativePlayer => {
      if (disposed || !state.ready || !native) throw new Error('YouTube is not ready. Open a video first.');
      return native;
    };
    const boundedPosition = (seconds: number): number => Math.min(state.duration || Number.MAX_SAFE_INTEGER, Math.max(0, finite(seconds)));
    const player: YouTubePlayer = {
      cue(id, startSeconds = 0) {
        if (!isYouTubeVideoId(id)) throw new Error('Use a valid YouTube video link.');
        const target = available(); expectedId = id; prepared = Math.min(Number.MAX_SAFE_INTEGER, Math.max(0, finite(startSeconds)));
        preserveRate = 1; pausePending = true; quietPause();
        state = { ...state, videoId: id, title: '', duration: 0, position: prepared, playing: false, blocked: false, rate: 1, rates: [1] };
        target.cueVideoById({ videoId: id, startSeconds: prepared }); emit();
      },
      play() {
        const target = available();
        if (!expectedId) return;
        pausePending = false; state.blocked = false;
        // Call directly within the user's tap, before any asynchronous work.
        target.playVideo(); emit();
      },
      pause() {
        if (disposed) return;
        pausePending = true; quietPause(); state.playing = false; emit();
      },
      seek(seconds, wasPlaying) {
        const target = available();
        if (!expectedId) return;
        const position = boundedPosition(seconds); prepared = position;
        if (wasPlaying) { pausePending = false; target.seekTo(position, true); target.playVideo(); }
        else {
          preserveRate = state.rate; pausePending = true; quietPause();
          // seekTo from CUED/UNSTARTED starts playback. Preparing a new cue avoids that first-Play trap.
          if (target.getPlayerState() === 2) target.seekTo(position, true);
          else target.cueVideoById({ videoId: expectedId, startSeconds: position });
          state.playing = false;
        }
        state.position = position; emit();
      },
      setRate(rate) {
        const target = available();
        if (!state.rates.includes(rate)) return;
        preserveRate = rate; target.setPlaybackRate(rate);
        // The rate event/poll reports what YouTube actually applied; a request is not confirmation.
      },
      snapshot() { return { ...state, ready: state.ready && !disposed, rates: [...state.rates] }; },
      dispose: cleanup,
    };
    signal?.addEventListener('abort', abort, { once: true });
    try {
      native = new api.Player(placeholder, {
        ...(!initialVideo ? { width: '100%', height: '100%',
          playerVars: { controls: 1, playsinline: 1, autoplay: 0, origin: location.origin, enablejsapi: 1 }, } : {}),
        events: {
          onReady(event) {
            if (disposed) { try { event.target.destroy(); } catch { /* Late owned frame. */ } return; }
            native = event.target; state.ready = true; clearTimeout(timer);
            signal?.removeEventListener('abort', abort); settled = true;
            read(); if (disposed) return;
            poll = setInterval(() => read(), 250); resolve(player);
          },
          onStateChange(event) {
            if (disposed) return;
            read(event.data);
            if (event.data === 5 && native && state.rates.includes(preserveRate) && state.rate !== preserveRate) native.setPlaybackRate(preserveRate);
          },
          onPlaybackRateChange() { read(); },
          onError(event) { fail(errorMessage(event.data)); },
          onAutoplayBlocked() {
            if (disposed) return;
            pausePending = false; state.playing = false; state.blocked = true; emit();
            reportError('Tap Play inside the YouTube video to allow playback in this browser.');
          },
        },
      });
      const iframe = native.getIframe();
      iframe.title = 'YouTube video player';
      iframe.referrerPolicy = 'strict-origin-when-cross-origin';
      iframe.allow = 'autoplay; encrypted-media; picture-in-picture; fullscreen';
      iframe.allowFullscreen = true;
    } catch { fail('YouTube could not create its player. Reload ClassTempo and try again.'); }
  });
}
