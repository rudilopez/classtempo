import type { LoadedTrack } from './deck';
import type { DancerPlayer } from './dancer-player';
import { StretchDeck } from './stretch-deck';

/** This ordering is the eight-channel worklet contract; model output order must be mapped explicitly. */
export const STEM_NAMES = ['vocals', 'drums', 'bass', 'other'] as const;
export type StemName = typeof STEM_NAMES[number];
export type StereoChannels = readonly [Float32Array, Float32Array];
export type StemBuffers = Readonly<Record<StemName, AudioBuffer>>;
export type StemChannels = Readonly<Record<StemName, StereoChannels>> & { readonly sampleRate: number };
export type StemMix = Readonly<Record<StemName, number>>;
export interface StemLoadOptions {
  /** Relinquish all supplied ArrayBuffers to avoid a full-song copy. Save/cache them before calling. */
  transfer?: boolean;
}
/** Kick/HiHat are filtered drum bands, not separately AI-isolated instruments. */
export type DrumFocus = 'full' | 'kick' | 'hihat';

const RAMP = 0.01;
const ALL_STEMS: StemMix = { vocals: 1, drums: 1, bass: 1, other: 1 };

/**
 * Four synchronized stereo stems through ONE eight-channel stretcher. A cue/tempo change schedules
 * all stems in the same audio block. Mixing follows stretching, so muting never changes position.
 * Created lazily by Engine and reused across loads; there is no model or inference dependency here.
 */
export class StemDeck implements DancerPlayer {
  readonly kind = 'audio' as const;
  /** Stereo mixed output, connected to the classroom gain by create(). */
  readonly node: GainNode;
  private readonly ctx: AudioContext;
  private readonly transport: StretchDeck;
  private readonly gains: Record<StemName, GainNode>;
  private readonly drumRoutes: Record<DrumFocus, GainNode>;
  private mix: StemMix = { ...ALL_STEMS };
  private focus: DrumFocus = 'full';

  private constructor(
    ctx: AudioContext,
    transport: StretchDeck,
    output: GainNode,
    gains: Record<StemName, GainNode>,
    drumRoutes: Record<DrumFocus, GainNode>,
  ) {
    this.ctx = ctx;
    this.transport = transport;
    this.node = output;
    this.gains = gains;
    this.drumRoutes = drumRoutes;
  }

  static async create(ctx: AudioContext, destination: AudioNode): Promise<StemDeck> {
    const splitter = new ChannelSplitterNode(ctx, { numberOfOutputs: 8 });
    const transport = await StretchDeck.create(ctx, splitter, 8);
    const output = new GainNode(ctx, { gain: 1, channelCount: 2, channelCountMode: 'explicit' });
    const gains = {} as Record<StemName, GainNode>;
    const drumRoutes = {} as Record<DrumFocus, GainNode>;
    STEM_NAMES.forEach((stem, index) => {
      const stereo = new ChannelMergerNode(ctx, { numberOfInputs: 2 });
      splitter.connect(stereo, index * 2, 0);
      splitter.connect(stereo, index * 2 + 1, 1);
      const gain = new GainNode(ctx, { gain: 1, channelCount: 2, channelCountMode: 'explicit' });
      gains[stem] = gain;
      if (stem === 'drums') {
        for (const focus of ['full', 'kick', 'hihat'] as const) {
          const route = new GainNode(ctx, { gain: focus === 'full' ? 1 : 0 });
          drumRoutes[focus] = route;
          if (focus === 'full') stereo.connect(route);
          else {
            const filter = new BiquadFilterNode(ctx, {
              type: focus === 'kick' ? 'lowpass' : 'highpass',
              frequency: focus === 'kick' ? 180 : 5000,
              Q: Math.SQRT1_2,
              channelCount: 2,
              channelCountMode: 'explicit',
            });
            stereo.connect(filter).connect(route);
          }
          route.connect(gain);
        }
      } else stereo.connect(gain);
      gain.connect(output);
    });
    output.connect(destination);
    return new StemDeck(ctx, transport, output, gains, drumRoutes);
  }

  /**
   * Buffers must be sample-aligned, equal-length and already resampled to ctx.sampleRate (decodeAudioData
   * does that). Mono stems are duplicated; multichannel stems are rejected rather than silently downmixed.
   */
  async load(buffers: StemBuffers, name: string): Promise<void> {
    const channels = {} as Record<StemName, StereoChannels>;
    for (const stem of STEM_NAMES) {
      const buffer = buffers[stem];
      if (!buffer || buffer.sampleRate !== this.ctx.sampleRate) {
        throw new Error('Resample all stems to the player sample rate before loading.');
      }
      if (buffer.numberOfChannels < 1 || buffer.numberOfChannels > 2) {
        throw new Error('Each stem must be mono or stereo.');
      }
      const left = buffer.getChannelData(0);
      channels[stem] = [left, buffer.numberOfChannels === 2 ? buffer.getChannelData(1) : left];
    }
    await this.loadChannels({ ...channels, sampleRate: this.ctx.sampleRate }, name);
  }

  /** Copies by default; transfer:true relinquishes all backing buffers. No implicit resampling/trimming. */
  async loadChannels(stems: StemChannels, name: string, options: StemLoadOptions = {}): Promise<void> {
    const channels: Float32Array[] = [];
    for (const stem of STEM_NAMES) {
      if (!stems[stem] || stems[stem].length !== 2) throw new Error(`Missing stereo ${stem} stem.`);
      channels.push(...stems[stem]);
    }
    await this.transport.loadChannels(channels, stems.sampleRate, name, options);
  }

  getMix(): StemMix { return { ...this.mix }; }

  setStemGain(stem: StemName, gain: number): void {
    if (!Number.isFinite(gain)) return;
    const level = Math.max(0, Math.min(1, gain));
    this.mix = { ...this.mix, [stem]: level };
    this.gains[stem].gain.setTargetAtTime(level, this.ctx.currentTime, RAMP);
  }

  /** Independent gains, ramped at the same context time. */
  setMix(mix: Partial<StemMix>): void {
    for (const stem of STEM_NAMES) {
      const gain = mix[stem];
      if (gain !== undefined) this.setStemGain(stem, gain);
    }
  }

  get drumFocus(): DrumFocus { return this.focus; }

  /** Crossfades drum bands; filtered bands replace rather than double the full drum signal. */
  setDrumFocus(focus: DrumFocus): void {
    this.focus = focus;
    for (const route of ['full', 'kick', 'hihat'] as const) {
      this.drumRoutes[route].gain.setTargetAtTime(route === focus ? 1 : 0, this.ctx.currentTime, RAMP);
    }
  }

  get track(): LoadedTrack | null { return this.transport.track; }
  get playing(): boolean { return this.transport.playing; }
  get position(): number { return this.transport.position; }
  get tempo(): number { return this.transport.tempo; }
  get onPosition(): DancerPlayer['onPosition'] { return this.transport.onPosition; }
  set onPosition(callback: DancerPlayer['onPosition']) { this.transport.onPosition = callback; }
  get onEnded(): DancerPlayer['onEnded'] { return this.transport.onEnded; }
  set onEnded(callback: DancerPlayer['onEnded']) { this.transport.onEnded = callback; }
  get onPlayingChange(): DancerPlayer['onPlayingChange'] { return this.transport.onPlayingChange; }
  set onPlayingChange(callback: DancerPlayer['onPlayingChange']) { this.transport.onPlayingChange = callback; }
  play(): void { this.transport.play(); }
  pause(): void { this.transport.pause(); }
  toggle(): void { this.transport.toggle(); }
  seek(seconds: number): void { this.transport.seek(seconds); }
  jumpTo(seconds: number): void { this.transport.jumpTo(seconds); }
  setTempo(rate: number): void { this.transport.setTempo(rate); }
  unload(): void { this.transport.unload(); }

  /** Keeps the worklet reusable but drops PCM, callbacks and mix settings. */
  release(): void {
    this.transport.release();
    this.setMix(ALL_STEMS);
    this.setDrumFocus('full');
  }
}
