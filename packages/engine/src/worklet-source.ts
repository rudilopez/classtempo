/**
 * Source of the deck AudioWorkletProcessor, shipped as a string and loaded via a Blob URL so it works
 * identically under any bundler. Phase 0: linear-interpolated variable-rate playback (pitch follows
 * tempo). Phase 1 replaces the inner loop with Signalsmith Stretch (WASM) for key lock.
 *
 * Messages in:  load { channels: Float32Array[] } | play | pause | seek { position } |
 *               loop { loop: { start, end } | null } | unload
 * Messages out: position { position, time } (throttled) | ended { position }
 * Params:       rate (k-rate) — 1.0 = original tempo, negative = reverse
 */
export const DECK_PROCESSOR_NAME = 'mixdeck-deck';

export const DECK_PROCESSOR_SOURCE = /* js */ `
class DeckProcessor extends AudioWorkletProcessor {
  static get parameterDescriptors() {
    return [{ name: 'rate', defaultValue: 1, minValue: -4, maxValue: 4, automationRate: 'k-rate' }];
  }

  constructor() {
    super();
    this.channels = null;
    this.length = 0;
    this.pos = 0;
    this.playing = false;
    this.loop = null;
    this.tick = 0;
    this.port.onmessage = (e) => this.handle(e.data);
  }

  handle(m) {
    switch (m.type) {
      case 'load':
        this.channels = m.channels;
        this.length = m.channels.length ? m.channels[0].length : 0;
        this.pos = 0;
        this.playing = false;
        this.loop = null;
        break;
      case 'play': this.playing = true; break;
      case 'pause': this.playing = false; this.report(); break;
      case 'seek':
        this.pos = Math.max(0, Math.min(m.position, Math.max(0, this.length - 2)));
        this.report();
        break;
      case 'loop': this.loop = m.loop; break;
      case 'unload':
        this.channels = null; this.length = 0; this.pos = 0; this.playing = false; this.loop = null;
        break;
    }
  }

  report() {
    this.port.postMessage({ type: 'position', position: this.pos, time: currentTime });
  }

  process(_inputs, outputs, params) {
    const out = outputs[0];
    const ch = this.channels;
    if (!ch || !this.playing || !out || out.length === 0) return true; // outputs are pre-zeroed

    const rate = params.rate[0];
    const n = out[0].length;
    const nCh = out.length;
    const loop = this.loop;
    const len = this.length;
    let pos = this.pos;

    for (let i = 0; i < n; i++) {
      if (loop) {
        if (pos >= loop.end) pos = loop.start + (pos - loop.end);
        else if (pos < loop.start && rate < 0) pos = loop.end - (loop.start - pos);
      }
      if (pos < 0 || pos >= len - 1) {
        this.playing = false;
        this.pos = Math.max(0, Math.min(pos, len - 2));
        this.port.postMessage({ type: 'ended', position: this.pos });
        return true;
      }
      const i0 = pos | 0;
      const frac = pos - i0;
      for (let c = 0; c < nCh; c++) {
        const src = ch[c < ch.length ? c : ch.length - 1];
        const s0 = src[i0];
        out[c][i] = s0 + (src[i0 + 1] - s0) * frac;
      }
      pos += rate;
    }
    this.pos = pos;
    if ((++this.tick & 7) === 0) this.report(); // ~every 21 ms at 48 kHz
    return true;
  }
}
registerProcessor('${DECK_PROCESSOR_NAME}', DeckProcessor);
`;
