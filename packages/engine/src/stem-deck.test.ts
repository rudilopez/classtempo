import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import SignalsmithStretch from 'signalsmith-stretch';
import { StemDeck, STEM_NAMES, type StemChannels } from './stem-deck';
import { StretchDeck } from './stretch-deck';

interface NodeOptions {
  gain?: number;
  numberOfInputs?: number;
  numberOfOutputs?: number;
  outputChannelCount?: number[];
  processorOptions?: { classTempoUnityBypass?: boolean };
  type?: BiquadFilterType;
  frequency?: number;
}

/** Channel-aware graph fake: verifies stereo routing rather than merely counting connect calls. */
class FakeNode {
  readonly inputs: { source: FakeNode; output: number; input: number }[] = [];
  readonly gain: { value: number; setTargetAtTime: ReturnType<typeof vi.fn> };
  constructor(readonly context: FakeContext, readonly options: NodeOptions = {}) {
    this.gain = { value: options.gain ?? 1, setTargetAtTime: vi.fn((value: number) => { this.gain.value = value; }) };
    context.nodes.push(this);
  }
  connect(target: FakeNode, output = 0, input = 0): FakeNode {
    target.inputs.push({ source: this, output, input });
    return target;
  }
  values(output = 0): number[] {
    if (this instanceof FakeSplitter) {
      return [this.inputs[0]?.source.values()[output] ?? 0];
    }
    if (this instanceof FakeMerger) {
      return Array.from({ length: this.options.numberOfInputs ?? 2 }, (_, index) =>
        this.inputs.filter((input) => input.input === index)
          .reduce((sum, input) => sum + (input.source.values(input.output)[0] ?? 0), 0),
      );
    }
    const sum = [0, 0];
    for (const input of this.inputs) {
      const values = input.source.values(input.output);
      for (let channel = 0; channel < 2; channel++) sum[channel]! += values[channel] ?? values[0] ?? 0;
    }
    return sum.map((value) => value * this.gain.value);
  }
}
class FakeSplitter extends FakeNode {}
class FakeMerger extends FakeNode {}
class FakeFilter extends FakeNode {}

class FakeContext {
  readonly nodes: FakeNode[] = [];
  readonly sampleRate = 16;
  currentTime = 0;
  readonly destination = new FakeNode(this);
}

class FakeStretch extends FakeNode {
  buffers: Float32Array[] = [];
  tick: (() => void) | undefined;
  readonly latency = vi.fn(async () => 0.12);
  readonly setUpdateInterval = vi.fn(async (_seconds: number, callback: () => void) => { this.tick = callback; });
  readonly schedule = vi.fn(async (change: object) => change);
  readonly dropBuffers = vi.fn(async () => { this.buffers = []; return { start: 0, end: 0 }; });
  readonly addBuffers = vi.fn(async (channels: Float32Array[], transfer: Transferable[]) => {
    this.buffers = structuredClone(channels, { transfer });
    return channels[0]?.length ?? 0;
  });
  override values(): number[] { return this.buffers.map((channel) => channel[0] ?? 0); }
}

vi.mock('signalsmith-stretch', () => ({
  default: vi.fn(async (context: FakeContext, options: NodeOptions) => new FakeStretch(context, options)),
}));

function fixture(context: FakeContext, frames = 16): StemChannels {
  const channel = (index: number) => new Float32Array(frames).fill(2 ** index);
  return {
    sampleRate: context.sampleRate,
    vocals: [channel(0), channel(1)],
    drums: [channel(2), channel(3)],
    bass: [channel(4), channel(5)],
    other: [channel(6), channel(7)],
  };
}

async function setup() {
  const context = new FakeContext();
  const deck = await StemDeck.create(context as unknown as AudioContext, context.destination as unknown as AudioNode);
  const processor = context.nodes.find((node): node is FakeStretch => node instanceof FakeStretch)!;
  return { context, deck, processor };
}

describe('synchronized stem playback', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal('ChannelSplitterNode', FakeSplitter);
    vi.stubGlobal('ChannelMergerNode', FakeMerger);
    vi.stubGlobal('GainNode', FakeNode);
    vi.stubGlobal('BiquadFilterNode', FakeFilter);
  });
  afterEach(() => vi.unstubAllGlobals());

  it('sums four stereo pairs without crossing channels, with independent click-free gains', async () => {
    const { context, deck, processor } = await setup();
    await deck.loadChannels(fixture(context), 'Lesson');
    expect(processor.options.outputChannelCount).toEqual([8]);
    expect(processor.options.processorOptions?.classTempoUnityBypass).toBe(true);
    expect(context.destination.values()).toEqual([85, 170]);
    deck.setMix({ vocals: 0, drums: 0, bass: 0, other: 1 });
    expect(context.destination.values()).toEqual([64, 128]);
    deck.setMix({ vocals: 0.5, other: 0 });
    expect(context.destination.values()).toEqual([0.5, 1]);
    expect(context.nodes.some((node) => node.gain.setTargetAtTime.mock.calls.some((call) =>
      call[0] === 0.5 && call[1] === context.currentTime && call[2] === 0.01,
    ))).toBe(true);
    deck.setStemGain('vocals', Number.NaN);
    expect(deck.getMix().vocals).toBe(0.5);
    deck.setStemGain('vocals', 2);
    expect(deck.getMix().vocals).toBe(1);
  });

  it('uses one schedule for every stem on cue, tempo, pause and end', async () => {
    const { context, deck, processor } = await setup();
    await deck.loadChannels(fixture(context), 'Lesson');
    const ended = vi.fn();
    const playing = vi.fn();
    deck.onEnded = ended;
    deck.onPlayingChange = playing;
    processor.schedule.mockClear();
    deck.jumpTo(0.25);
    expect(processor.schedule).toHaveBeenCalledExactlyOnceWith({ active: true, input: 0.25, output: 0.06 });
    deck.setTempo(0.75);
    expect(processor.schedule.mock.lastCall?.[0]).toEqual({ rate: 0.75, output: 0.06 });
    expect(deck.tempo).toBe(0.75);
    context.currentTime = 2;
    processor.tick?.();
    expect(deck.position).toBe(1);
    expect(deck.playing).toBe(false);
    expect(ended).toHaveBeenCalledOnce();
    expect(playing.mock.calls).toEqual([[true], [false]]);
    processor.tick?.();
    expect(ended).toHaveBeenCalledOnce();
    expect(SignalsmithStretch).toHaveBeenCalledTimes(1);
  });

  it('copies by default and transfers unique backing buffers only when explicitly requested', async () => {
    const { context, deck, processor } = await setup();
    const copy = fixture(context);
    await deck.loadChannels(copy, 'Copied');
    expect(copy.vocals[0].length).toBe(16);
    expect(processor.buffers[0]).not.toBe(copy.vocals[0]);

    const shared = new ArrayBuffer(8 * 16 * Float32Array.BYTES_PER_ELEMENT);
    const channels = Array.from({ length: 8 }, (_, index) => new Float32Array(shared, index * 16 * 4, 16).fill(index));
    const transfer: StemChannels = {
      sampleRate: context.sampleRate,
      vocals: [channels[0]!, channels[1]!], drums: [channels[2]!, channels[3]!],
      bass: [channels[4]!, channels[5]!], other: [channels[6]!, channels[7]!],
    };
    await deck.loadChannels(transfer, 'Transferred', { transfer: true });
    expect(shared.byteLength).toBe(0);
    expect(processor.addBuffers.mock.lastCall?.[1]).toHaveLength(1);
    expect(processor.buffers.map((channel) => channel[0])).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
    expect(deck.track).toEqual({ name: 'Transferred', duration: 1 });
  });

  it('rejects wrong sample rates, unaligned or nonfinite samples before changing the active track', async () => {
    const { context, deck } = await setup();
    await deck.loadChannels(fixture(context), 'Valid');
    deck.play();
    await expect(deck.loadChannels({ ...fixture(context), sampleRate: 44_100 }, 'Wrong rate')).rejects.toThrow('Resample');
    await expect(deck.loadChannels({ ...fixture(context), bass: [new Float32Array(15), new Float32Array(16)] }, 'Short')).rejects.toThrow('same number');
    const invalid = fixture(context);
    invalid.other[1][4] = Number.NaN;
    await expect(deck.loadChannels(invalid, 'Invalid')).rejects.toThrow('finite samples');
    await expect(deck.loadChannels(fixture(context, 0), 'Empty')).rejects.toThrow('cannot be empty');
    expect(deck.track?.name).toBe('Valid');
    expect(deck.playing).toBe(true);
  });

  it('duplicates mono decoded stems, rejecting incompatible decoded channels', async () => {
    const { context, deck } = await setup();
    const makeBuffer = (numberOfChannels = 1): AudioBuffer => ({
      sampleRate: context.sampleRate, numberOfChannels,
      getChannelData: () => new Float32Array(16).fill(1),
    }) as unknown as AudioBuffer;
    const buffers = { vocals: makeBuffer(), drums: makeBuffer(), bass: makeBuffer(), other: makeBuffer() };
    await deck.load(buffers, 'Mono stems');
    expect(context.destination.values()).toEqual([4, 4]);
    await expect(deck.load({ ...buffers, bass: makeBuffer(6) }, 'Surround')).rejects.toThrow('mono or stereo');
    expect(deck.track?.name).toBe('Mono stems');
  });

  it('replaces full drums with one focused band without adding duplicate drums', async () => {
    const { context, deck } = await setup();
    await deck.loadChannels(fixture(context), 'Lesson');
    deck.setMix({ vocals: 0, bass: 0, other: 0 });
    for (const focus of ['kick', 'hihat', 'full'] as const) {
      deck.setDrumFocus(focus);
      expect(deck.drumFocus).toBe(focus);
      expect(context.destination.values()).toEqual([4, 8]);
    }
    const filters = context.nodes.filter((node) => node instanceof FakeFilter);
    expect(filters.map((filter) => [filter.options.type, filter.options.frequency])).toEqual([
      ['lowpass', 180], ['highpass', 5000],
    ]);
  });

  it('unloads and releases without creating another worklet, resetting callbacks and mix', async () => {
    const { context, deck, processor } = await setup();
    await deck.loadChannels(fixture(context), 'First');
    deck.setTempo(0.8);
    deck.setMix({ vocals: 0 });
    deck.setDrumFocus('kick');
    deck.onEnded = vi.fn();
    deck.release();
    expect(deck.track).toBeNull();
    expect(deck.tempo).toBe(1);
    expect(deck.onEnded).toBeNull();
    expect(deck.drumFocus).toBe('full');
    expect(STEM_NAMES.map((stem) => deck.getMix()[stem])).toEqual([1, 1, 1, 1]);
    await deck.loadChannels(fixture(context), 'Second');
    expect(deck.track?.name).toBe('Second');
    expect(processor.buffers).toHaveLength(8);
    expect(SignalsmithStretch).toHaveBeenCalledTimes(1);
  });

  it('cancels a superseded load without transferring its buffers or reviving a track', async () => {
    const { context, deck, processor } = await setup();
    const source = fixture(context);
    const loading = deck.loadChannels(source, 'Cancelled', { transfer: true });
    deck.unload();
    await loading;
    expect(deck.track).toBeNull();
    expect(processor.addBuffers).not.toHaveBeenCalled();
    expect(source.vocals[0].length).toBe(16);
  });

  it('keeps ordinary audio at two output channels', async () => {
    const context = new FakeContext();
    await StretchDeck.create(context as unknown as AudioContext, context.destination as unknown as AudioNode);
    expect(vi.mocked(SignalsmithStretch).mock.lastCall?.[1]?.outputChannelCount).toEqual([2]);
    expect(vi.mocked(SignalsmithStretch).mock.lastCall?.[1]?.processorOptions?.classTempoUnityBypass).toBe(false);
  });
});
