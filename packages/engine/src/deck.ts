import { DECK_PROCESSOR_NAME } from './worklet-source';

export type EqBand = 'low' | 'mid' | 'high';

export interface LoadedTrack {
  name: string;
  /** seconds */
  duration: number;
}

export interface LoopRange {
  /** seconds, in track time (independent of playback rate) */
  start: number;
  end: number;
}

const RAMP = 0.01; // seconds, de-zippers gain/EQ changes

/**
 * One deck: an AudioWorklet player → 3-band EQ → channel fader → output.
 * All public times are seconds in track time; the worklet works in samples at the context rate
 * (decodeAudioData resamples to the context rate, so samples/seconds convert with ctx.sampleRate).
 */
export class Deck {
  readonly input: AudioWorkletNode;
  readonly eq: Record<EqBand, BiquadFilterNode>;
  readonly fader: GainNode;
  /** Connect this to the mixer. */
  readonly output: GainNode;

  track: LoadedTrack | null = null;
  /** seconds */
  cuePoint = 0;

  onPosition: ((seconds: number) => void) | null = null;
  onEnded: (() => void) | null = null;

  private readonly ctx: AudioContext;
  private readonly rateParam: AudioParam;
  private positionSamples = 0;
  private _playing = false;
  private _pitch = 0; // percent
  private _loop: LoopRange | null = null;

  constructor(ctx: AudioContext) {
    this.ctx = ctx;
    this.input = new AudioWorkletNode(ctx, DECK_PROCESSOR_NAME, {
      numberOfInputs: 0,
      numberOfOutputs: 1,
      outputChannelCount: [2],
    });
    const rate = this.input.parameters.get('rate');
    if (!rate) throw new Error('deck processor is missing the rate param');
    this.rateParam = rate;

    this.eq = {
      low: new BiquadFilterNode(ctx, { type: 'lowshelf', frequency: 200 }),
      mid: new BiquadFilterNode(ctx, { type: 'peaking', frequency: 1000, Q: 0.7 }),
      high: new BiquadFilterNode(ctx, { type: 'highshelf', frequency: 4000 }),
    };
    this.fader = new GainNode(ctx, { gain: 1 });
    this.output = new GainNode(ctx, { gain: 1 });

    this.input
      .connect(this.eq.low)
      .connect(this.eq.mid)
      .connect(this.eq.high)
      .connect(this.fader)
      .connect(this.output);

    this.input.port.onmessage = (e: MessageEvent) => {
      const m = e.data as { type: string; position: number };
      if (m.type === 'position') {
        this.positionSamples = m.position;
        this.onPosition?.(this.position);
      } else if (m.type === 'ended') {
        this.positionSamples = m.position;
        this._playing = false;
        this.onPosition?.(this.position);
        this.onEnded?.();
      }
    };
  }

  // ---- track -------------------------------------------------------------------------------

  /** Copies up to 2 channels out of the buffer and transfers them to the worklet. */
  load(buffer: AudioBuffer, name: string): void {
    const channels: Float32Array[] = [];
    for (let c = 0; c < Math.min(buffer.numberOfChannels, 2); c++) {
      channels.push(buffer.getChannelData(c).slice());
    }
    this.input.port.postMessage({ type: 'load', channels }, channels.map((c) => c.buffer));
    this.track = { name, duration: buffer.duration };
    this.positionSamples = 0;
    this._playing = false;
    this._loop = null;
    this.cuePoint = 0;
    this.onPosition?.(0);
  }

  unload(): void {
    this.input.port.postMessage({ type: 'unload' });
    this.track = null;
    this.positionSamples = 0;
    this._playing = false;
    this._loop = null;
  }

  // ---- transport ---------------------------------------------------------------------------

  get playing(): boolean {
    return this._playing;
  }

  /** seconds */
  get position(): number {
    return this.positionSamples / this.ctx.sampleRate;
  }

  play(): void {
    if (!this.track) return;
    this._playing = true;
    this.input.port.postMessage({ type: 'play' });
  }

  pause(): void {
    this._playing = false;
    this.input.port.postMessage({ type: 'pause' });
  }

  toggle(): void {
    this._playing ? this.pause() : this.play();
  }

  seek(seconds: number): void {
    if (!this.track) return;
    const s = Math.max(0, Math.min(seconds, this.track.duration));
    this.positionSamples = s * this.ctx.sampleRate;
    this.input.port.postMessage({ type: 'seek', position: this.positionSamples });
    this.onPosition?.(s);
  }

  /** CDJ-style cue: playing → jump to cue and stop; stopped → set cue here. */
  cue(): void {
    if (this._playing) {
      this.pause();
      this.seek(this.cuePoint);
    } else {
      this.cuePoint = this.position;
    }
  }

  // ---- tempo -------------------------------------------------------------------------------

  /** Pitch fader in percent; +8 = 8 % faster. Phase 0 changes pitch with tempo (no key lock). */
  get pitch(): number {
    return this._pitch;
  }

  setPitch(percent: number): void {
    this._pitch = percent;
    this.rateParam.setTargetAtTime(1 + percent / 100, this.ctx.currentTime, RAMP);
  }

  /** Effective playback rate multiplier. */
  get rate(): number {
    return 1 + this._pitch / 100;
  }

  // ---- loops -------------------------------------------------------------------------------

  get loop(): LoopRange | null {
    return this._loop;
  }

  setLoop(loop: LoopRange | null): void {
    this._loop = loop;
    const sr = this.ctx.sampleRate;
    this.input.port.postMessage({
      type: 'loop',
      loop: loop ? { start: loop.start * sr, end: loop.end * sr } : null,
    });
  }

  // ---- mixer strip -------------------------------------------------------------------------

  setEq(band: EqBand, gainDb: number): void {
    this.eq[band].gain.setTargetAtTime(gainDb, this.ctx.currentTime, RAMP);
  }

  /** 0..1 linear fader. */
  setFader(level: number): void {
    this.fader.gain.setTargetAtTime(Math.max(0, Math.min(1, level)), this.ctx.currentTime, RAMP);
  }
}
