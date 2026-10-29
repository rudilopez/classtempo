import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { YouTubePlayer, YouTubeSnapshot } from './client';

const id = 'M7lc1UVf-VE';
class Element extends EventTarget {
  src = ''; async = false; referrerPolicy = ''; title = ''; allow = ''; allowFullscreen = false;
  children: Element[] = []; remove = vi.fn();
  appendChild(child: Element) { this.children.push(child); return child; }
  matches(_selector: string): boolean { throw new DOMException('Unsupported selector', 'SyntaxError'); }
}
class Native {
  status = -1; time = 0; duration = 120; rate = 1; rates = [0.5, 0.75, 1, 1.5];
  volume = 80;
  muted = false;
  video = { video_id: '', title: '' }; iframe = new Element();
  cueVideoById = vi.fn((value: { videoId: string; startSeconds: number }) => { this.video = { video_id: value.videoId, title: 'Dance video' }; this.time = 0; this.rate = 1; });
  playVideo = vi.fn(); pauseVideo = vi.fn(); seekTo = vi.fn(); setPlaybackRate = vi.fn(); destroy = vi.fn();
  setVolume = vi.fn((volume: number) => { this.volume = volume; });
  getVolume() { return this.volume; }
  mute = vi.fn(() => { this.muted = true; });
  unMute = vi.fn(() => { this.muted = false; });
  isMuted() { return this.muted; }
  getPlaybackRate() { return this.rate; }
  getAvailablePlaybackRates() { return this.rates; }
  getCurrentTime() { return this.time; }
  getDuration() { return this.duration; }
  getPlayerState() { return this.status; }
  getVideoUrl() { return this.video.video_id ? `https://www.youtube.com/watch?v=${this.video.video_id}` : ''; }
  getIframe() { return this.iframe; }
}
type Events = Record<'onReady' | 'onStateChange' | 'onPlaybackRateChange' | 'onError' | 'onAutoplayBlocked', (event: { target: Native; data?: number }) => void>;
let native: Native; let events: Events; let options: { videoId?: string; playerVars?: Record<string, unknown> };
let host: Element; let scripts: Element[]; let active: YouTubePlayer | undefined;
let snapshots: YouTubeSnapshot[]; let errors: ReturnType<typeof vi.fn>;
let constructor: ReturnType<typeof vi.fn>;
let factory: typeof import('./client')['createYouTubePlayer'];

beforeEach(async () => {
  vi.resetModules(); vi.useFakeTimers(); native = new Native(); host = new Element(); scripts = []; active = undefined; snapshots = []; errors = vi.fn();
  constructor = vi.fn(function (_host: Element, supplied: typeof options & { events: Events }) { options = supplied; events = supplied.events; if (_host.src) native.iframe = _host; const ownEvents = supplied.events; queueMicrotask(() => ownEvents.onReady({ target: native })); return native; });
  vi.stubGlobal('YT', { Player: constructor });
  vi.stubGlobal('location', { origin: 'https://example.com' });
  vi.stubGlobal('document', { createElement: () => new Element(), head: { appendChild: (element: Element) => { scripts.push(element); } } });
  factory = (await import('./client')).createYouTubePlayer;
});
afterEach(() => { active?.dispose(); vi.clearAllTimers(); vi.useRealTimers(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });
async function create(signal?: AbortSignal) {
  active = await factory(host as unknown as HTMLElement, value => snapshots.push(value), errors, signal);
  return active;
}
function state(status: number) { native.status = status; events.onStateChange({ target: native, data: status }); }

describe('YouTube official player ownership', () => {
  it('does not initialize on import, and creates a visible standard inline player with no autoplay', async () => {
    await import('./client'); expect(constructor).not.toHaveBeenCalled(); expect(scripts).toHaveLength(0);
    const player = await create(); expect(player.snapshot().ready).toBe(true);
    expect(options.playerVars).toEqual({ controls: 1, playsinline: 1, autoplay: 0, origin: 'https://example.com', enablejsapi: 1 });
    expect(native.iframe.referrerPolicy).toBe('strict-origin-when-cross-origin'); expect(native.iframe.allowFullscreen).toBe(true);
    expect(native.playVideo).not.toHaveBeenCalled();
  });
  it('opens paused at the prepared timestamp, and Play is synchronous', async () => {
    const player = await create(); player.cue(id, 25); state(5);
    expect(native.cueVideoById).toHaveBeenCalledWith({ videoId: id, startSeconds: 25 });
    expect(player.snapshot()).toMatchObject({ videoId: id, position: 25, playing: false });
    expect(native.playVideo).not.toHaveBeenCalled(); player.play(); expect(native.playVideo).toHaveBeenCalledOnce();
    native.time = 25.1; state(1); expect(player.snapshot().playing).toBe(true); expect(player.snapshot().position).toBe(25.1);
  });
  it('configures an existing privacy-enhanced iframe before insertion and gives that same node to the API', async () => {
    native.video = { video_id: id, title: 'Dance video' }; native.status = 5;
    const atInsertion: { src?: string; policy?: string; allow?: string } = {};
    vi.spyOn(host, 'appendChild').mockImplementation(child => {
      atInsertion.src = child.src; atInsertion.policy = child.referrerPolicy; atInsertion.allow = child.allow;
      host.children.push(child); return child;
    });
    active = await factory(host as unknown as HTMLElement, value => snapshots.push(value), errors, undefined, { id, startSeconds: 25.5 });
    const url = new URL(atInsertion.src!);
    expect(url.origin + url.pathname).toBe(`https://www.youtube-nocookie.com/embed/${id}`);
    expect(Object.fromEntries(url.searchParams)).toEqual({ autoplay: '0', controls: '1', start: '25', origin: 'https://example.com', enablejsapi: '1', playsinline: '1' });
    expect(atInsertion.policy).toBe('strict-origin-when-cross-origin'); expect(atInsertion.allow).toContain('fullscreen');
    expect(constructor.mock.calls[0]?.[0]).toBe(host.children[0]); expect(native.getIframe()).toBe(host.children[0]);
    expect(options.videoId).toBeUndefined(); expect(options.playerVars).toBeUndefined();
    expect(active.snapshot()).toMatchObject({ ready: true, videoId: id, position: 25.5, playing: false });
    expect(native.playVideo).not.toHaveBeenCalled();
  });
  it('reads a sanitized real iframe title through the documented DOM accessor without depending on metadata', async () => {
    const player = await create(); player.cue(id); state(5);
    expect(player.snapshot().title).toBe('');
    native.iframe.title = 'YouTube Developers Live: Embedded Web Player Customization'; state(5);
    expect(player.snapshot().title).toBe(native.iframe.title);
    native.iframe.title = '\n' + 'A'.repeat(300) + '\u0000'; state(5); expect(player.snapshot().title).toBe('A'.repeat(250));
    vi.spyOn(native, 'getIframe').mockImplementationOnce(() => { throw new Error('Unavailable optional title'); });
    state(5); expect(player.snapshot()).toMatchObject({ ready: true, title: '', playing: false });
    expect(errors).not.toHaveBeenCalled();
  });
  it('a paused cue before first Play never uses seekTo, which would start a cued video', async () => {
    const player = await create(); player.cue(id); state(5); player.seek(20, false); state(5);
    expect(native.cueVideoById).toHaveBeenLastCalledWith({ videoId: id, startSeconds: 20 });
    expect(native.seekTo).not.toHaveBeenCalled(); expect(native.playVideo).not.toHaveBeenCalled();
    expect(player.snapshot()).toMatchObject({ position: 20, playing: false });
  });
  it('lets native YouTube Play and seeking replace an old prepared cue position', async () => {
    const player = await create(); player.cue(id, 25); state(5);
    native.time = 70; state(1); expect(player.snapshot()).toMatchObject({ playing: true, position: 70 });
    native.time = 90; await vi.advanceTimersByTimeAsync(250); expect(player.snapshot().position).toBe(90);
  });
  it('playing cues seek and keep playing; paused cues remain paused and retain their actual rate', async () => {
    const player = await create(); player.cue(id); state(5); player.play(); state(1);
    player.seek(35, true); expect(native.seekTo).toHaveBeenLastCalledWith(35, true); expect(native.playVideo).toHaveBeenCalledTimes(2);
    native.time = 35; state(1); player.pause(); state(2); native.rate = 0.75; events.onPlaybackRateChange({ target: native, data: 0.75 });
    native.playVideo.mockClear(); player.seek(12, false);
    expect(native.seekTo).toHaveBeenLastCalledWith(12, true); expect(native.playVideo).not.toHaveBeenCalled();
    expect(player.snapshot()).toMatchObject({ playing: false, position: 12, rate: 0.75 });
  });
  it('reapplies a supported rate after the safe pre-Play cue resets the native rate', async () => {
    const player = await create(); player.cue(id); state(5); native.rate = 0.75; events.onPlaybackRateChange({ target: native, data: 0.75 });
    player.seek(12, false); state(5); expect(native.setPlaybackRate).toHaveBeenLastCalledWith(0.75);
    expect(player.snapshot().rate).toBe(1); // No optimistic success until YouTube confirms it.
    native.rate = 0.75; events.onPlaybackRateChange({ target: native, data: 0.75 }); expect(player.snapshot().rate).toBe(0.75);
  });
  it('uses only advertised rates and reports the actual changed rate, including native controls', async () => {
    const player = await create(); player.cue(id); state(5); player.setRate(0.83); expect(native.setPlaybackRate).not.toHaveBeenCalled();
    player.setRate(0.75); expect(native.setPlaybackRate).toHaveBeenCalledWith(0.75); expect(player.snapshot().rate).toBe(1);
    native.rate = 0.75; events.onPlaybackRateChange({ target: native, data: 0.75 }); expect(player.snapshot().rate).toBe(0.75);
    native.rate = 0.5; events.onPlaybackRateChange({ target: native, data: 0.5 }); expect(player.snapshot().rate).toBe(0.5);
  });
  it('Talk lowers and restores the original volume without pausing, seeking or starting playback', async () => {
    const player = await create(); player.cue(id); state(5); player.play(); state(1);
    native.playVideo.mockClear(); native.pauseVideo.mockClear();
    expect(player.ducked).toBe(false);
    expect(player.setDucked(true)).toBe(true);
    expect(player.ducked).toBe(true);
    expect(player.talkMuted).toBe(false);
    expect(native.setVolume).toHaveBeenLastCalledWith(16);
    expect(player.snapshot().playing).toBe(true);
    // Repeated UI requests must not capture the already-lowered volume as the baseline.
    expect(player.setDucked(true)).toBe(true); expect(native.setVolume).toHaveBeenCalledOnce();
    native.time = 12; await vi.advanceTimersByTimeAsync(250);
    expect(player.snapshot().position).toBe(12);
    expect(player.setDucked(false)).toBe(true); expect(native.setVolume).toHaveBeenLastCalledWith(80);
    expect(player.ducked).toBe(false);
    expect(native.playVideo).not.toHaveBeenCalled(); expect(native.pauseVideo).not.toHaveBeenCalled(); expect(native.seekTo).not.toHaveBeenCalled();
  });
  it('finishing Talk on a paused video does not start it, including before the first Play', async () => {
    const player = await create(); player.cue(id); state(5);
    native.pauseVideo.mockClear(); player.setDucked(true); player.setDucked(false);
    expect(native.setVolume.mock.calls.map(call => call[0])).toEqual([16, 80]);
    expect(player.snapshot().playing).toBe(false); expect(native.playVideo).not.toHaveBeenCalled(); expect(native.pauseVideo).not.toHaveBeenCalled();
  });
  it.each(['play', 'pause', 'seek', 'cue', 'rate', 'dispose'] as const)('restores volume before the next %s action', async action => {
    const player = await create(); player.cue(id); state(5); player.setDucked(true);
    if (action === 'play') player.play();
    else if (action === 'pause') player.pause();
    else if (action === 'seek') player.seek(12, true);
    else if (action === 'cue') player.cue(id, 5);
    else if (action === 'rate') player.setRate(0.75);
    else player.dispose();
    expect(native.setVolume.mock.calls.map(call => call[0])).toEqual([16, 80]);
    expect(native.volume).toBe(80);
    expect(player.ducked).toBe(false);
    player.setDucked(false); expect(native.setVolume).toHaveBeenCalledTimes(2);
  });
  it('restores Talk volume after provider errors and does not revive playback', async () => {
    const player = await create(); player.cue(id); state(5); player.setDucked(true);
    events.onError({ target: native, data: 100 });
    expect(native.volume).toBe(80); expect(player.snapshot().playing).toBe(false); expect(native.playVideo).not.toHaveBeenCalled();
  });
  it.each([2, 0])('restores Talk volume after native pause/end state %s without restarting', async status => {
    const player = await create(); player.cue(id); state(5); player.play(); state(1); native.playVideo.mockClear();
    player.setDucked(true); state(status);
    expect(player.ducked).toBe(false);
    expect(native.volume).toBe(80); expect(player.snapshot().playing).toBe(false); expect(native.playVideo).not.toHaveBeenCalled();
  });
  it('uses mute when volume readings or commands fail, leaving transport usable', async () => {
    const player = await create(); player.cue(id); state(5);
    vi.spyOn(native, 'getVolume').mockReturnValueOnce(Number.NaN);
    expect(player.setDucked(true)).toBe(true); expect(player.talkMuted).toBe(true); expect(native.setVolume).not.toHaveBeenCalled();
    expect(native.muted).toBe(true); player.setDucked(false); expect(native.muted).toBe(false);
    native.setVolume.mockImplementationOnce(() => { throw new Error('Volume unavailable'); });
    expect(player.setDucked(true)).toBe(true); expect(player.talkMuted).toBe(true); expect(native.volume).toBe(80);
    player.play(); expect(native.playVideo).toHaveBeenCalledOnce(); expect(errors).not.toHaveBeenCalled();
  });
  it('does not increase a silent volume or unmute a player through the volume path', async () => {
    const player = await create(); player.cue(id); state(5); native.volume = 0;
    player.setDucked(true); player.setDucked(false);
    expect(native.setVolume.mock.calls.map(call => call[0])).toEqual([0, 0]);
    expect(native.unMute).not.toHaveBeenCalled();
  });
  it('mutes on volume-locked devices while keeping the video playing, then restores original mute state', async () => {
    const player = await create(); player.cue(id); state(5); player.play(); state(1);
    native.playVideo.mockClear(); native.pauseVideo.mockClear();
    vi.spyOn(Element.prototype, 'matches').mockReturnValue(true);
    expect(player.setDucked(true)).toBe(true); expect(player.ducked).toBe(true); expect(player.talkMuted).toBe(true);
    expect(native.muted).toBe(true); expect(native.setVolume).not.toHaveBeenCalled();
    player.setDucked(true); expect(native.mute).toHaveBeenCalledOnce();
    native.time = 12; await vi.advanceTimersByTimeAsync(250);
    expect(player.snapshot()).toMatchObject({ playing: true, position: 12 });
    expect(player.setDucked(false)).toBe(true); expect(player.talkMuted).toBe(false); expect(native.muted).toBe(false);
    expect(native.playVideo).not.toHaveBeenCalled(); expect(native.pauseVideo).not.toHaveBeenCalled();
  });
  it('uses the iPhone fallback only when volume feature detection is unavailable', async () => {
    const player = await create(); player.cue(id); state(5);
    vi.stubGlobal('navigator', { userAgent: 'iPhone', platform: 'iPhone' });
    expect(player.setDucked(true)).toBe(true); expect(player.talkMuted).toBe(true); player.setDucked(false);
    vi.spyOn(Element.prototype, 'matches').mockReturnValue(false);
    expect(player.setDucked(true)).toBe(true); expect(player.talkMuted).toBe(false);
    expect(native.setVolume).toHaveBeenLastCalledWith(16);
  });
  it('leaves originally muted audio muted when Talk finishes', async () => {
    const player = await create(); player.cue(id); state(5); native.muted = true;
    expect(player.setDucked(true)).toBe(true); expect(player.talkMuted).toBe(true);
    expect(native.mute).not.toHaveBeenCalled(); player.setDucked(false);
    expect(native.muted).toBe(true); expect(native.unMute).not.toHaveBeenCalled(); expect(native.setVolume).not.toHaveBeenCalled();
  });
  it.each(['pause', 'seek', 'cue', 'rate', 'dispose'] as const)('restores fallback mute on %s without reviving old playback', async action => {
    const player = await create(); player.cue(id); state(5);
    vi.spyOn(Element.prototype, 'matches').mockReturnValue(true); player.setDucked(true);
    if (action === 'pause') player.pause();
    else if (action === 'seek') player.seek(10, false);
    else if (action === 'cue') player.cue(id);
    else if (action === 'rate') player.setRate(0.75);
    else player.dispose();
    expect(native.muted).toBe(false); expect(player.ducked).toBe(false); expect(player.talkMuted).toBe(false);
    expect(native.playVideo).not.toHaveBeenCalled();
  });
  it('falls back safely if optional volume methods are unavailable', async () => {
    const player = await create(); player.cue(id); state(5);
    Object.defineProperty(native, 'getVolume', { value: undefined });
    expect(player.setDucked(true)).toBe(true); expect(player.talkMuted).toBe(true);
    player.setDucked(false); expect(native.muted).toBe(false);
  });
  it('reports unavailable audio controls honestly without touching playback', async () => {
    const player = await create(); player.cue(id); state(5);
    vi.spyOn(Element.prototype, 'matches').mockReturnValue(true);
    native.mute.mockImplementationOnce(() => { throw new Error('Mute unavailable'); });
    expect(player.setDucked(true)).toBe(false); expect(player.ducked).toBe(false); expect(native.muted).toBe(false);
    Object.defineProperty(native, 'unMute', { value: undefined });
    expect(player.setDucked(true)).toBe(false); expect(player.ducked).toBe(false);
    expect(native.playVideo).not.toHaveBeenCalled(); expect(errors).not.toHaveBeenCalled();
  });
  it('cancels stale playback after Pause, then permits a real native Play after pause confirmation', async () => {
    const player = await create(); player.cue(id); state(5); player.play(); state(1); player.pause(); native.pauseVideo.mockClear();
    state(1); expect(native.pauseVideo).toHaveBeenCalledOnce(); expect(player.snapshot().playing).toBe(false);
    state(2); state(1); expect(player.snapshot().playing).toBe(true);
  });
  it('explains autoplay blocking and lets a native Play recover without being suppressed', async () => {
    const player = await create(); player.cue(id); state(5); player.play(); events.onAutoplayBlocked({ target: native });
    expect(player.snapshot()).toMatchObject({ blocked: true, playing: false }); expect(errors).toHaveBeenLastCalledWith(expect.stringContaining('inside the YouTube'));
    state(1); expect(player.snapshot()).toMatchObject({ playing: true, blocked: false });
  });
  it('does not attach old cue controls to an unexpected suggested video', async () => {
    const player = await create(); player.cue(id); state(5); native.video = { video_id: 'abcdefghijk', title: 'Other' }; state(1);
    expect(native.pauseVideo).toHaveBeenCalled(); expect(player.snapshot().videoId).toBe(id);
    expect(errors).toHaveBeenLastCalledWith(expect.stringContaining('new video'));
  });
  it.each([2, 5, 100, 101, 150, 153])('reports a safe actionable provider error %s', async code => {
    const player = await create(); player.cue(id); events.onError({ target: native, data: code });
    expect(errors).toHaveBeenCalledOnce(); expect(player.snapshot().playing).toBe(false);
    expect(String(errors.mock.calls[0]?.[0])).not.toMatch(/undefined|token|Bearer/);
  });
  it('destroys its owned frame, stops polling and ignores every late callback on teardown', async () => {
    const player = await create(); player.cue(id); player.dispose(); const before = snapshots.length;
    state(1); events.onError({ target: native, data: 100 }); events.onReady({ target: native });
    await vi.advanceTimersByTimeAsync(5000);
    expect(snapshots).toHaveLength(before); expect(errors).not.toHaveBeenCalled(); expect(player.snapshot().ready).toBe(false);
    expect(native.destroy).toHaveBeenCalled(); expect(() => player.play()).toThrow('not ready');
  });
  it('cancels an owned frame while ready is pending and cleans its placeholder', async () => {
    constructor.mockImplementationOnce(function (_host, supplied) { events = supplied.events; return native; });
    const controller = new AbortController(); const opening = create(controller.signal); const rejected = expect(opening).rejects.toMatchObject({ name: 'AbortError' });
    await Promise.resolve(); await Promise.resolve(); await Promise.resolve();
    expect(constructor).toHaveBeenCalledOnce(); controller.abort(); await rejected;
    expect(native.destroy).toHaveBeenCalledOnce(); expect(host.children[0]?.remove).toHaveBeenCalledOnce();
  });
  it('can cancel a real initial-video iframe before ready without autoplay or retaining its node', async () => {
    constructor.mockImplementationOnce(function (_host, supplied) { options = supplied; events = supplied.events; return native; });
    const controller = new AbortController();
    const opening = factory(host as unknown as HTMLElement, vi.fn(), errors, controller.signal, { id, startSeconds: 12 });
    const rejected = expect(opening).rejects.toMatchObject({ name: 'AbortError' });
    await Promise.resolve(); await Promise.resolve(); await Promise.resolve();
    expect(new URL(host.children[0]!.src).pathname).toBe(`/embed/${id}`); controller.abort(); await rejected;
    expect(native.destroy).toHaveBeenCalledOnce(); expect(native.playVideo).not.toHaveBeenCalled();
  });
  it('bounds startup and cleans a player which never reports ready', async () => {
    constructor.mockImplementationOnce(function (_host, supplied) { events = supplied.events; return native; });
    const opening = create(); const rejected = expect(opening).rejects.toThrow('did not finish');
    await Promise.resolve();
    await vi.advanceTimersByTimeAsync(20_001); await rejected; expect(native.destroy).toHaveBeenCalledOnce();
  });
});

describe('YouTube script startup', () => {
  it('lazily loads the official script once for concurrent callers and preserves another callback', async () => {
    vi.stubGlobal('YT', undefined); const previous = vi.fn(); vi.stubGlobal('onYouTubeIframeAPIReady', previous);
    const { createYouTubePlayer } = await import('./client');
    const first = createYouTubePlayer(host as unknown as HTMLElement, vi.fn(), errors);
    const other = createYouTubePlayer(new Element() as unknown as HTMLElement, vi.fn(), errors);
    expect(scripts).toHaveLength(1); expect(scripts[0]?.src).toBe('https://www.youtube.com/iframe_api');
    vi.stubGlobal('YT', { Player: constructor });
    const global = globalThis as typeof globalThis & { onYouTubeIframeAPIReady?: () => void }; global.onYouTubeIframeAPIReady?.();
    const a = await first; const b = await other; a.dispose(); b.dispose(); expect(previous).toHaveBeenCalledOnce();
  });
  it('times out a blocked script and allows a later retry', async () => {
    vi.stubGlobal('YT', undefined); const waiting = create(); const rejected = expect(waiting).rejects.toThrow('could not load');
    await vi.advanceTimersByTimeAsync(20_001); await rejected; expect(scripts[0]?.remove).toHaveBeenCalledOnce();
    const retry = create(); expect(scripts).toHaveLength(2); const retryRejected = expect(retry).rejects.toThrow('could not load'); scripts[1]?.dispatchEvent(new Event('error')); await retryRejected;
  });
  it('aborts a caller immediately while leaving a shared SDK load safe for others', async () => {
    vi.stubGlobal('YT', undefined); const controller = new AbortController();
    const waiting = create(controller.signal); const rejected = expect(waiting).rejects.toMatchObject({ name: 'AbortError' });
    await Promise.resolve(); await Promise.resolve(); controller.abort(); await rejected;
    expect(constructor).not.toHaveBeenCalled();
  });
});
