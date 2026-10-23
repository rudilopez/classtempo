/// <reference path="./signalsmith-stretch.d.ts" />
import SignalsmithStretch, { type StretchNode, type StretchSchedule } from 'signalsmith-stretch';
import type { LoadedTrack } from './deck';
import type { DancerPlayer } from './dancer-player';

/** Position report cadence while playing, seconds. */
const UPDATE_INTERVAL = 0.05;
/** Within this much of the end counts as ended, seconds. */
const END_EPSILON = 0.02;
const MAX_SEMITONES = 24;

export const STRETCH_MIN_TEMPO = 0.5;
export const STRETCH_MAX_TEMPO = 1.5;

/** Subset of a time-map change the deck sends. */
interface Change {
  active?: boolean;
  input?: number;
  rate?: number;
  semitones?: number;
}

/**
 * Key-locked single-track player on Signalsmith Stretch (WASM AudioWorklet): tempo changes never
 * change pitch. Used by Dancer mode. All public times are seconds in track time.
 *
 * The node keeps a map of segments (output time → input position, rate, active); every change here is
 * one `schedule()` call stamped `lookahead` (= the stretcher's output latency, 60 ms) ahead of
 * `ctx.currentTime`, the same alignment the wrapper's own `start()` uses. The segment then takes over
 * exactly as the synthesis delay drains, so a launched cue is heard from its position instead of
 * ~60 ms past it, and a pause stops where the readout says.
 *
 * Position is mirrored on the main thread from that map (input + elapsed × rate) rather than read from
 * the node's `inputTime` reports: while playing those carry the read-ahead (input latency + output
 * latency × rate, ≈120 ms ahead of what is audible) but the ones posted in reply to a schedule do not,
 * so they jump on every pause. The periodic reports serve only as the tick for `onPosition` and end
 * detection — the node never stops by itself; past the end of its buffers it keeps advancing through
 * silence.
 */
export class StretchDeck implements DancerPlayer {
  readonly kind = 'audio' as const;
  /** Already connected to the destination given to `create`. */
  readonly node: AudioNode;

  track: LoadedTrack | null = null;

  /** ~every 50 ms while playing, and after every transport change. */
  onPosition: ((seconds: number) => void) | null = null;
  /** Once when playback reaches the end; the deck is then paused at `duration`. */
  onEnded: (() => void) | null = null;
  /**
   * On every play/pause transition: play, pause, jumpTo, load / unload while playing, and the end of the
   * track (before `onEnded`).
   */
  onPlayingChange: ((playing: boolean) => void) | null = null;

  private readonly ctx: AudioContext;
  private readonly stretch: StretchNode;
  private readonly lookahead: number;
  private readonly channelCount: number;
  /** Input position at the start of the latest scheduled segment. */
  private segInput = 0;
  /** AudioContext time the latest scheduled segment starts at. */
  private segStart = 0;
  private _playing = false;
  private _tempo = 1;
  private _semitones = 0;
  private loadSeq = 0;

  private constructor(ctx: AudioContext, stretch: StretchNode, latency: number, channelCount: number) {
    this.ctx = ctx;
    this.stretch = stretch;
    this.node = stretch;
    // Default preset: input and output latency are equal (60 ms each at any sample rate).
    this.lookahead = latency / 2;
    this.channelCount = channelCount;
  }

  /**
   * Creates the Signalsmith node (registers its worklet module on first use) and connects it to
   * `destination`. The node can never be torn down again — the wrapper's processor always returns true
   * from process(), so it keeps rendering after disconnect() — so create one per context and reuse it
   * (`Engine.getStretchDeck` does this); `release()` hands it back between uses.
   */
  static async create(ctx: AudioContext, destination: AudioNode, channelCount = 2, unityBypass = false): Promise<StretchDeck> {
    if (!Number.isInteger(channelCount) || channelCount < 1 || channelCount > 8) {
      throw new Error('The stretch player needs between 1 and 8 channels.');
    }
    // Keep numberOfInputs at 1 (the wrapper's default): the processor's idle branch indexes the input
    // list and throws with 0 inputs. Unconnected, the input is empty and the node plays its buffers.
    const stretch = await SignalsmithStretch(ctx, {
      numberOfInputs: 1,
      numberOfOutputs: 1,
      outputChannelCount: [channelCount],
      processorOptions: { classTempoUnityBypass: unityBypass },
    });
    const latency = await stretch.latency();
    const deck = new StretchDeck(ctx, stretch, latency, channelCount);
    stretch.connect(destination);
    await stretch.setUpdateInterval(UPDATE_INTERVAL, () => deck.tick());
    return deck;
  }

  // ---- track -------------------------------------------------------------------------------

  /** Replaces the node's buffers with up to 2 channels of `buffer` (mono duplicated); rewound, paused, tempo kept. */
  async load(buffer: AudioBuffer, name: string): Promise<void> {
    if (this.channelCount !== 2) throw new Error('Use loadChannels for a multichannel player.');
    const left = buffer.getChannelData(0);
    const right = buffer.numberOfChannels > 1 ? buffer.getChannelData(1) : left;
    await this.loadChannels([left, right], this.ctx.sampleRate, name);
  }

  /**
   * Loads aligned PCM already resampled to the AudioContext rate. Copies channels by default. Explicit
   * ownership transfer avoids that allocation: callers must never use any supplied backing buffer again.
   * Invalid input leaves the currently loaded track unchanged.
   */
  async loadChannels(
    channels: readonly Float32Array[],
    sampleRate: number,
    name: string,
    { transfer = false }: { transfer?: boolean } = {},
  ): Promise<void> {
    validateStretchChannels(channels, sampleRate, this.ctx.sampleRate, this.channelCount);
    if (transfer && channels.some((channel) => !(channel.buffer instanceof ArrayBuffer))) {
      throw new Error('Ownership transfer requires ordinary ArrayBuffers.');
    }
    const seq = ++this.loadSeq;
    this.track = null;
    this.schedule({ active: false, input: 0 });
    const frames = channels[0]!.length;
    const owned = transfer ? [...channels] : channels.map((channel) => channel.slice());
    await this.stretch.dropBuffers();
    if (seq !== this.loadSeq) return; // superseded by a newer load/unload
    await this.stretch.addBuffers(owned, [...new Set(owned.map((channel) => channel.buffer))]);
    if (seq !== this.loadSeq) return;
    // The worklet plays samples at the context rate (decodeAudioData resamples to it).
    this.track = { name, duration: frames / this.ctx.sampleRate };
    this.onPosition?.(0);
  }

  unload(): void {
    this.loadSeq++;
    this.track = null;
    this.schedule({ active: false, input: 0 });
    void this.stretch.dropBuffers();
  }

  /**
   * Hands the deck back for its next user: silent, empty, callbacks cleared, tempo and pitch at their
   * defaults. The node stays connected (see `create`); the deck is reusable afterwards.
   */
  release(): void {
    this.onPosition = null;
    this.onEnded = null;
    this.onPlayingChange = null;
    this.unload();
    this.setTempo(1);
    this.setSemitones(0);
  }

  // ---- transport ---------------------------------------------------------------------------

  get playing(): boolean {
    return this._playing;
  }

  /** Seconds, clamped to [0, duration]. Live, not quantised to the report interval. */
  get position(): number {
    const duration = this.track?.duration ?? 0;
    const elapsed = this._playing ? Math.max(0, this.ctx.currentTime - this.segStart) : 0;
    return Math.max(0, Math.min(this.segInput + elapsed * this._tempo, duration));
  }

  /** Resumes; from the end it restarts at 0. */
  play(): void {
    if (!this.track || this._playing) return;
    if (this.position >= this.track.duration) this.schedule({ active: true, input: 0 });
    else this.schedule({ active: true });
    this.onPosition?.(this.position);
  }

  pause(): void {
    if (!this._playing) return;
    this.schedule({ active: false });
    this.onPosition?.(this.position);
  }

  toggle(): void {
    this._playing ? this.pause() : this.play();
  }

  /** Works playing or paused. */
  seek(seconds: number): void {
    if (!this.track) return;
    this.schedule({ input: this.clampTime(seconds) });
    this.onPosition?.(this.position);
  }

  /** Seek and play as one scheduled change — cue launch. */
  jumpTo(seconds: number): void {
    if (!this.track) return;
    this.schedule({ active: true, input: this.clampTime(seconds) });
    this.onPosition?.(this.position);
  }

  // ---- tempo / pitch -----------------------------------------------------------------------

  /** Playback-rate multiplier, 0.5..1.5, default 1. Pitch is always preserved (key lock). */
  get tempo(): number {
    return this._tempo;
  }

  /** Clamped to [0.5, 1.5]. Click-free: the stretcher re-seeks with the new rate every block. */
  setTempo(rate: number): void {
    if (!Number.isFinite(rate)) return;
    const r = Math.max(STRETCH_MIN_TEMPO, Math.min(STRETCH_MAX_TEMPO, rate));
    if (r === this._tempo) return;
    this.schedule({ rate: r });
  }

  get semitones(): number {
    return this._semitones;
  }

  /** Optional pitch shift on top of key lock, −24..24 semitones, default 0. */
  setSemitones(n: number): void {
    if (!Number.isFinite(n)) return;
    const s = Math.max(-MAX_SEMITONES, Math.min(MAX_SEMITONES, n));
    if (s === this._semitones) return;
    this.schedule({ semitones: s });
  }

  // ---- internals ---------------------------------------------------------------------------

  private clampTime(seconds: number): number {
    const duration = this.track?.duration ?? 0;
    return Number.isFinite(seconds) ? Math.max(0, Math.min(seconds, duration)) : 0;
  }

  /**
   * Applies `change` `lookahead` ahead of now, mirroring the node's own segment arithmetic (a new
   * segment inherits the previous one, with its input advanced by elapsed × rate while active) so
   * `position` stays in step with the worklet's time map. Only defined keys are sent: the wrapper
   * treats a present-but-undefined `input` as given. Fires `onPlayingChange` last, once the change is
   * sent, so a handler may call back into the deck.
   */
  private schedule(change: Change): void {
    const wasPlaying = this._playing;
    const at = this.ctx.currentTime + this.lookahead;
    const elapsed = this._playing ? Math.max(0, at - this.segStart) : 0;
    this.segInput = change.input ?? this.segInput + elapsed * this._tempo;
    this.segStart = at;
    if (change.active !== undefined) this._playing = change.active;
    if (change.rate !== undefined) this._tempo = change.rate;
    if (change.semitones !== undefined) this._semitones = change.semitones;

    const msg: StretchSchedule = { output: at };
    if (change.active !== undefined) msg.active = change.active;
    if (change.input !== undefined) msg.input = change.input;
    if (change.rate !== undefined) msg.rate = change.rate;
    if (change.semitones !== undefined) msg.semitones = change.semitones;
    void this.stretch.schedule(msg);
    if (this._playing !== wasPlaying) this.onPlayingChange?.(this._playing);
  }

  /** Runs on every worklet time report: periodically while playing, and once per schedule. */
  private tick(): void {
    const track = this.track;
    if (!track) return;
    if (this._playing && this.position >= track.duration - END_EPSILON) {
      this.schedule({ active: false, input: track.duration });
      this.onPosition?.(this.position);
      this.onEnded?.();
      return;
    }
    this.onPosition?.(this.position);
  }
}

/** Pure validation shared by stem loading and the transport; it never silently changes timing. */
export function validateStretchChannels(
  channels: readonly Float32Array[],
  sampleRate: number,
  contextRate: number,
  channelCount: number,
): void {
  if (!Number.isFinite(sampleRate) || sampleRate <= 0 || sampleRate !== contextRate) {
    throw new Error('Resample all stem channels to the player sample rate before loading.');
  }
  if (channels.length !== channelCount) throw new Error(`Expected ${channelCount} aligned audio channels.`);
  const frames = channels[0]?.length ?? 0;
  if (!frames) throw new Error('Audio channels cannot be empty.');
  for (const channel of channels) {
    if (!(channel instanceof Float32Array) || channel.length !== frames) {
      throw new Error('Every audio channel must have the same number of samples.');
    }
    for (let frame = 0; frame < channel.length; frame++) {
      if (!Number.isFinite(channel[frame])) throw new Error('Audio channels must contain finite samples.');
    }
  }
}
