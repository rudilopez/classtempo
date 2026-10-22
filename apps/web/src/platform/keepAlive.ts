/**
 * Silent looping `<audio>` keep-alive. While it plays, the browser treats the page as a media player, and Media
 * Session metadata/handlers attach to it. On iOS / iPadOS the Web Audio graph then keeps running with the screen
 * locked and the lock-screen Now Playing controls appear. On Android, Chrome shows its media notification (and
 * so lock-screen and headphone controls) only for an `<audio>`/`<video>` element longer than 5 s, never for Web
 * Audio output, so this element is what makes those controls possible there. Start it in the same tap that
 * starts playback; a locked phone cannot start audio.
 */

/** Length of the generated loop, seconds: clearly over the 5 s Chrome needs before it shows a media notification. */
const LOOP_SECONDS = 10;
/** Sample rate of the generated loop, Hz (8 kHz keeps the 10 s file at about 160 KB). */
const LOOP_SAMPLE_RATE = 8000;
const WAV_HEADER_BYTES = 44;

export interface KeepAlive {
  /**
   * Starts (or restarts) the silent loop. Call it synchronously inside a user gesture: `play()` is issued before
   * the first await. Never rejects; a refusal (NotAllowedError outside a gesture, AbortError from a racing
   * `stop()`) just leaves it stopped.
   */
  start(): Promise<void>;
  /** Pauses the loop; lock-screen controls then show the paused state. */
  stop(): void;
  /** Stops and removes the element and frees its Blob URL. A later `start()` builds a fresh one. */
  dispose(): void;
}

/**
 * Bytes of a silent 16-bit PCM mono WAV file: a 44-byte header plus `round(seconds × sampleRate)` zero samples.
 * Non-finite or negative durations give an empty data chunk; the rate is rounded and clamped to 1–384000 Hz.
 */
export function makeSilentWav(seconds: number, sampleRate: number): Uint8Array<ArrayBuffer> {
  const rate = Number.isFinite(sampleRate) ? Math.min(384000, Math.max(1, Math.round(sampleRate))) : LOOP_SAMPLE_RATE;
  const frames = Number.isFinite(seconds) && seconds > 0 ? Math.round(seconds * rate) : 0;
  const dataBytes = frames * 2;
  const bytes = new Uint8Array(WAV_HEADER_BYTES + dataBytes);
  const view = new DataView(bytes.buffer);
  const ascii = (offset: number, text: string) => {
    for (let i = 0; i < text.length; i++) view.setUint8(offset + i, text.charCodeAt(i));
  };
  ascii(0, 'RIFF');
  view.setUint32(4, 36 + dataBytes, true);
  ascii(8, 'WAVE');
  ascii(12, 'fmt ');
  view.setUint32(16, 16, true); // fmt chunk size
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, 1, true); // mono
  view.setUint32(24, rate, true);
  view.setUint32(28, rate * 2, true); // byte rate
  view.setUint16(32, 2, true); // block align
  view.setUint16(34, 16, true); // bits per sample
  ascii(36, 'data');
  view.setUint32(40, dataBytes, true);
  return bytes;
}

/** A keep-alive for the page. Builds nothing until the first `start()`; a no-op where there is no DOM. */
export function createKeepAlive(): KeepAlive {
  let audio: HTMLAudioElement | null = null;
  let url: string | null = null;

  const release = () => {
    if (audio) {
      audio.pause();
      audio.removeAttribute('src');
      audio.load();
      audio.remove();
      audio = null;
    }
    if (url) {
      URL.revokeObjectURL(url);
      url = null;
    }
  };

  const element = (): HTMLAudioElement | null => {
    if (audio) return audio;
    if (typeof document === 'undefined' || typeof URL.createObjectURL !== 'function') return null;
    try {
      url = URL.createObjectURL(new Blob([makeSilentWav(LOOP_SECONDS, LOOP_SAMPLE_RATE)], { type: 'audio/wav' }));
      const el = document.createElement('audio');
      el.loop = true;
      el.preload = 'auto';
      // Not `muted`: muted media does not count as playing, so iOS would neither keep the page alive nor show
      // the lock-screen controls. The file is all zeros, so nothing is heard.
      el.setAttribute('playsinline', '');
      el.setAttribute('webkit-playsinline', '');
      el.setAttribute('aria-hidden', 'true');
      el.hidden = true;
      el.src = url;
      document.body?.appendChild(el);
      audio = el;
    } catch (err) {
      console.warn('[mixdeck] keep-alive audio unavailable', err);
      release();
    }
    return audio;
  };

  return {
    async start() {
      const el = element();
      if (!el || !el.paused) return;
      try {
        await el.play();
      } catch (err) {
        const name = typeof err === 'object' && err !== null && 'name' in err ? err.name : '';
        if (name !== 'NotAllowedError' && name !== 'AbortError') console.warn('[mixdeck] keep-alive audio did not start', err);
      }
    },
    stop() {
      audio?.pause();
    },
    dispose() {
      try {
        release();
      } catch {
        audio = null;
        url = null;
      }
    },
  };
}
