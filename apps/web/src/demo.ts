/**
 * Synthesised demo track so the app can be tried (and e2e-tested) without any audio files:
 * kick on every beat, hat on off-beats, a bass note per bar, 8 bars of intro without hats.
 */
export function makeDemoTrack(ctx: BaseAudioContext, bpm: number, bars = 64, rootHz = 55): AudioBuffer {
  const sr = ctx.sampleRate;
  const beat = 60 / bpm;
  const length = Math.floor(bars * 4 * beat * sr);
  const buffer = ctx.createBuffer(2, length, sr);
  const l = buffer.getChannelData(0);
  const r = buffer.getChannelData(1);

  let seed = 1;
  const noise = () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 0xffffffff - 0.5;
  };

  for (let b = 0; b < bars * 4; b++) {
    const start = Math.floor(b * beat * sr);
    const bar = Math.floor(b / 4);
    // kick: pitch sweep 150→50 Hz over 120 ms
    for (let i = 0; i < sr * 0.12 && start + i < length; i++) {
      const t = i / sr;
      const f = 50 + 100 * Math.exp(-t * 30);
      const v = Math.sin(2 * Math.PI * f * t) * Math.exp(-t * 18) * 0.8;
      l[start + i]! += v;
      r[start + i]! += v;
    }
    // hat on the off-beat (after the 8-bar intro)
    if (bar >= 8) {
      const hs = start + Math.floor((beat / 2) * sr);
      for (let i = 0; i < sr * 0.03 && hs + i < length; i++) {
        const v = noise() * Math.exp(-i / (sr * 0.006)) * 0.25;
        l[hs + i]! += v * 1.1;
        r[hs + i]! += v * 0.9;
      }
    }
    // bass note per bar, chord cycle i–VI–IV–V
    if (b % 4 === 0) {
      const semis = [0, -3, 5, 7][bar % 4]!;
      const f = rootHz * Math.pow(2, semis / 12);
      const len = Math.floor(beat * 3.5 * sr);
      for (let i = 0; i < len && start + i < length; i++) {
        const t = i / sr;
        const env = Math.min(1, t * 50) * Math.exp(-t * 0.8);
        const v = (Math.sin(2 * Math.PI * f * t) + 0.3 * Math.sin(2 * Math.PI * f * 2 * t)) * env * 0.25;
        l[start + i]! += v;
        r[start + i]! += v;
      }
    }
  }
  return buffer;
}
