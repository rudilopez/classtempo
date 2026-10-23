/// <reference path="./audio-session.d.ts" />
import { Deck } from './deck';
import { StretchDeck } from './stretch-deck';
import { StemDeck } from './stem-deck';
import { DECK_PROCESSOR_SOURCE } from './worklet-source';

const RAMP = 0.01;

/**
 * Owns the AudioContext and the mixer graph:
 *   deck[0].output → xf[0] ┐
 *                          ├→ master → destination
 *   deck[1].output → xf[1] ┘
 *   stretch deck / lazy stem deck → dancer gain (0.9) → destination
 * DJ master and crossfader settings never affect Dancer mode (see getStretchDeck).
 * It can be created without a user gesture: the context then starts 'suspended' (autoplay policy) and the first
 * tap, click or key press calls `unlock()` (or `resume()`) to start it.
 */
export class Engine {
  readonly ctx: AudioContext;
  private readonly djDecks: readonly [Deck, Deck] | null;
  readonly master: GainNode;
  private readonly dancerGain: GainNode;
  private readonly xf: readonly [GainNode, GainNode];
  private _crossfader = 0;
  private stretchDeck: Promise<StretchDeck> | null = null;
  private stemDeck: Promise<StemDeck> | null = null;

  private constructor(ctx: AudioContext, dj: boolean) {
    this.ctx = ctx;
    this.master = new GainNode(ctx, { gain: 0.9 });
    this.master.connect(ctx.destination);
    this.dancerGain = new GainNode(ctx, { gain: 0.9 });
    this.dancerGain.connect(ctx.destination);
    this.xf = [new GainNode(ctx), new GainNode(ctx)];
    this.djDecks = dj ? [new Deck(ctx), new Deck(ctx)] : null;
    this.djDecks?.[0].output.connect(this.xf[0]).connect(this.master);
    this.djDecks?.[1].output.connect(this.xf[1]).connect(this.master);
    this.setCrossfader(0);
  }

  /**
   * Creates the context and loads the deck worklet. Needs no user gesture and never waits for one: outside a gesture
   * the context stays 'suspended' until `unlock()` / `resume()` is called from one (awaiting `resume()` here would
   * hang on iOS / iPadOS until the first tap).
   */
  static async create({ dj = true }: { dj?: boolean } = {}): Promise<Engine> {
    // Before the context exists, so its very first output is already treated as media playback.
    setPlaybackAudioSession();
    const ctx = new AudioContext({ latencyHint: 'interactive' });
    // The classroom player needs no DJ processors running in the background.
    if (!dj) return new Engine(ctx, false);
    const url = URL.createObjectURL(new Blob([DECK_PROCESSOR_SOURCE], { type: 'application/javascript' }));
    try {
      await ctx.audioWorklet.addModule(url);
    } catch (e) {
      void ctx.close().catch(() => {});
      throw e;
    } finally {
      URL.revokeObjectURL(url);
    }
    return new Engine(ctx, true);
  }

  /** Legacy mixer access; the classroom engine deliberately creates no DJ decks. */
  get decks(): readonly [Deck, Deck] {
    if (!this.djDecks) throw new Error('DJ decks are not enabled in the classroom player.');
    return this.djDecks;
  }

  /** Relative classroom output level, used to lower the song while the instructor talks. */
  setDancerGain(level: number): void {
    if (!Number.isFinite(level)) return;
    this.dancerGain.gain.setTargetAtTime(0.9 * Math.max(0, Math.min(1, level)), this.ctx.currentTime, RAMP);
  }

  /** -1 = deck A only, +1 = deck B only. Equal-power curve. */
  get crossfader(): number {
    return this._crossfader;
  }

  setCrossfader(x: number): void {
    this._crossfader = Math.max(-1, Math.min(1, x));
    const t = ((this._crossfader + 1) / 2) * (Math.PI / 2);
    const now = this.ctx.currentTime;
    this.xf[0].gain.setTargetAtTime(Math.cos(t), now, RAMP);
    this.xf[1].gain.setTargetAtTime(Math.sin(t), now, RAMP);
  }

  setMasterGain(level: number): void {
    this.master.gain.setTargetAtTime(Math.max(0, Math.min(1.5, level)), this.ctx.currentTime, RAMP);
  }

  /**
   * The key-locked single-track deck (Dancer mode), connected through its own fixed gain to the output. Created on
   * first use and shared from then on: once its processor exists it renders for the life of the
   * context whether or not it is connected, so there is one per engine, not one per use — callers
   * `release()` it when done instead of discarding it. A failed creation is retried on the next call.
   */
  getStretchDeck(): Promise<StretchDeck> {
    if (!this.stretchDeck) {
      this.stretchDeck = StretchDeck.create(this.ctx, this.dancerGain).catch((e: unknown) => {
        this.stretchDeck = null;
        throw e;
      });
    }
    return this.stretchDeck;
  }

  /** Lazily creates one synchronized stem player; normal song/video use never initializes it. */
  getStemDeck(): Promise<StemDeck> {
    if (!this.stemDeck) {
      this.stemDeck = StemDeck.create(this.ctx, this.dancerGain).catch((e: unknown) => {
        this.stemDeck = null;
        throw e;
      });
    }
    return this.stemDeck;
  }

  /** Decodes any format the browser supports, resampled to the context rate. */
  async decode(file: Blob): Promise<AudioBuffer> {
    return this.ctx.decodeAudioData(await file.arrayBuffer());
  }

  /** Estimated output latency in seconds. */
  get latency(): number {
    return this.ctx.baseLatency + (this.ctx.outputLatency ?? 0);
  }

  resume(): Promise<void> {
    return this.ctx.resume();
  }

  /**
   * Starts a context that is not running ('suspended' before the first gesture, or 'interrupted'). Call it
   * synchronously inside a user gesture (tap, click, key press) or a Media Session action handler: browsers only let
   * a context start from one. Fire-and-forget; a refused or failed resume is ignored (a later gesture tries again).
   */
  unlock(): void {
    const state = this.ctx.state;
    if (state === 'running' || state === 'closed') return;
    try {
      void this.ctx.resume().catch(() => {});
    } catch {
      // closed, or resume() threw synchronously: nothing to start
    }
  }

  async close(): Promise<void> {
    await this.ctx.close();
  }
}

/**
 * Declares the page's audio as media playback where the Audio Session API exists (Safari 16.4+): it then plays
 * with the Ring/Silent switch on and, with the keep-alive element, keeps playing in the background with the
 * screen locked (iOS / iPadOS 17.5+). Browsers without the API skip this; a failure here never blocks audio.
 */
function setPlaybackAudioSession(): void {
  try {
    const session = typeof navigator === 'undefined' ? undefined : navigator.audioSession;
    if (session && session.type !== 'playback') session.type = 'playback';
  } catch {
    // Sound still plays, just as ambient audio (muted by the Silent switch).
  }
}
