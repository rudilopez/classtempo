import { describe, expect, it } from 'vitest';
import upstream from '../../../../node_modules/signalsmith-stretch/SignalsmithStretch.mjs?raw';
import { adaptStemUnitySource, stemUnityPlayback } from '../../build/stemUnityPlayback';

const RATE = 44_100;
const LATENCY = 2_646;

interface Segment { active?: boolean; input?: number; output: number; rate?: number; semitones?: number }
interface Processor {
  port: { onmessage: (event: { data: unknown[] }) => void };
  process: (inputs: Float32Array[][], outputs: Float32Array[][], parameters: object) => boolean;
  wasmModule: { _process: (input: number, output: number) => void };
  audioBuffers: Float32Array[][];
}
type ProcessorConstructor = new (options: AudioWorkletNodeOptions) => Processor;

/** Runs the actual pinned WASM and wrapper with only the AudioWorklet host replaced. */
async function player(unityBypass = true, sampleRate = RATE) {
  const source = await adaptStemUnitySource(upstream);
  const clock = { currentTime: 0 };
  const messages: unknown[][] = [];
  let Constructor: ProcessorConstructor | undefined;
  let resolveReady: (() => void) | undefined;
  const ready = new Promise<void>((resolve) => { resolveReady = resolve; });
  class Host {
    port = { postMessage: (message: unknown[]) => {
      messages.push(message);
      if (message[0] === 'ready') resolveReady?.();
    } };
  }
  const run = new Function('AudioWorkletProcessor', 'registerProcessor', 'sampleRate', 'clock',
    source.replaceAll(/\bcurrentTime\b/g, 'clock.currentTime').replace('let _export=SignalsmithStretch;export default _export;', ''));
  run(Host, (_name: string, constructor: ProcessorConstructor) => { Constructor = constructor; }, sampleRate, clock);
  if (!Constructor) throw new Error('The actual worklet was not registered.');
  const processor = new Constructor({ numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [8],
    processorOptions: { classTempoUnityBypass: unityBypass } });
  await ready;
  let calls = 0;
  const process = processor.wasmModule._process;
  const countProcess = (input: number, output: number) => {
    calls++;
    process(input, output);
    // Emscripten lazily assigns the native export on its first call.
    processor.wasmModule._process = countProcess;
  };
  processor.wasmModule._process = countProcess;
  let frame = 0;
  const command = (name: string, argument: unknown) => processor.port.onmessage({ data: [1, name, argument] });
  const render = (blocks: number): Float32Array[] => {
    const rendered = Array.from({ length: 8 }, () => new Float32Array(blocks * 128));
    for (let block = 0; block < blocks; block++) {
      clock.currentTime = frame / sampleRate;
      const outputs = rendered.map((channel) => channel.subarray(block * 128, (block + 1) * 128));
      processor.process([[]], [outputs], {});
      frame += 128;
    }
    clock.currentTime = frame / sampleRate;
    return rendered;
  };
  return { processor, messages, render, command, clock, calls: () => calls,
    schedule: (segment: Segment) => command('schedule', segment) };
}

function samples(seconds = 3, sampleRate = RATE): Float32Array[] {
  return Array.from({ length: 8 }, (_, channel) => Float32Array.from({ length: sampleRate * seconds }, (_, frame) =>
    0.1 * Math.sin(frame * (0.01 + channel * 0.007)) + 0.05 * Math.sin(frame * 0.113)));
}

describe('stem unity playback adapter', () => {
  it.each([44_100, 48_000])('copies every stem sample exactly at 100%% and %i Hz without WASM or extra PCM ownership', async (sampleRate) => {
    const p = await player(true, sampleRate);
    const channels = samples(3, sampleRate);
    const latency = Math.round(sampleRate * 0.06);
    p.command('addBuffers', channels);
    p.command('setUpdateInterval', 0.05);
    p.schedule({ active: true, input: 0, output: latency / sampleRate, rate: 1 });
    const output = p.render(400);
    for (let channel = 0; channel < 8; channel++) {
      expect(output[channel]!.subarray(0, latency).every((value) => value === 0)).toBe(true);
      expect(output[channel]!.subarray(latency)).toEqual(channels[channel]!.subarray(0, output[0]!.length - latency));
      expect(p.processor.audioBuffers[0]![channel]).toBe(channels[channel]);
    }
    expect(p.calls()).toBe(0);
    expect(p.messages.filter((message) => message[0] === 'time').length).toBeGreaterThan(10);
  });

  it('applies cue, pause, resume and past-end silence at the existing scheduled sample', async () => {
    const p = await player();
    const channels = samples(1);
    p.command('addBuffers', channels);
    p.schedule({ active: true, input: 0, output: p.clock.currentTime + 0.06 });
    p.render(80);
    const at = p.clock.currentTime + 0.06;
    p.schedule({ input: 0.6, output: at });
    const cue = p.render(50);
    expect(cue[0]![LATENCY]).toBe(channels[0]![Math.round(0.6 * RATE)]);
    p.schedule({ active: false, output: p.clock.currentTime + 0.06 });
    const paused = p.render(50);
    expect(paused[0]!.subarray(LATENCY).every((value) => value === 0)).toBe(true);
    p.schedule({ active: true, input: 0.95, output: p.clock.currentTime + 0.06 });
    const resumed = p.render(70);
    expect(resumed[0]![LATENCY]).toBe(channels[0]![Math.round(0.95 * RATE)]);
    expect(resumed[0]!.subarray(LATENCY + Math.round(0.05 * RATE)).every((value) => value === 0)).toBe(true);
    expect(p.calls()).toBe(0);
  });

  it('discards a pending cue or pause when a newer command replaces it within the lookahead', async () => {
    const p = await player();
    const channels = samples();
    p.command('addBuffers', channels);
    p.schedule({ active: true, input: 0, output: 0.06 });
    p.render(80);
    p.schedule({ input: 1.5, output: p.clock.currentTime + 0.06 });
    p.render(5);
    p.schedule({ active: true, input: 0.5, output: p.clock.currentTime + 0.06 });
    const output = p.render(60);
    expect(output[0]![LATENCY]).toBe(channels[0]![RATE / 2]);
    p.schedule({ active: false, output: p.clock.currentTime + 0.06 });
    p.render(5);
    p.schedule({ active: true, input: 1, output: p.clock.currentTime + 0.06 });
    const resumed = p.render(50);
    expect(resumed[0]![LATENCY]).toBe(channels[0]![RATE]);
    expect(resumed[0]!.subarray(0, LATENCY).some((value) => value !== 0)).toBe(true);
    expect(p.calls()).toBe(0);
  });

  it.each([44_100, 48_000])('warms slower tempo and returns to exact 100%% PCM at %i Hz', async (sampleRate) => {
    const p = await player(true, sampleRate);
    const channels = samples(3, sampleRate);
    const latency = Math.round(sampleRate * 0.06);
    p.command('addBuffers', channels);
    p.schedule({ active: true, input: 0, output: 0.06 });
    p.render(120);
    p.schedule({ rate: 0.8, output: p.clock.currentTime + 0.06 });
    const slower = p.render(120);
    expect(p.calls()).toBeGreaterThan(80);
    // A sustained zero block during this non-silent fixture would reveal an unprimed transition.
    for (let start = latency; start + 128 < slower[0]!.length; start += 128) {
      expect(slower[0]!.subarray(start, start + 128).some((value) => Math.abs(value) > 1e-5)).toBe(true);
    }
    const resumedInput = (120 * 128 / sampleRate) * 1.8;
    p.schedule({ rate: 1, output: p.clock.currentTime + 0.06 });
    const normal = p.render(120);
    const sourceFrame = Math.round(resumedInput * sampleRate);
    expect(normal[0]!.subarray(latency)).toEqual(channels[0]!.subarray(sourceFrame, sourceFrame + normal[0]!.length - latency));
    const calls = p.calls();
    p.render(120);
    expect(p.calls()).toBe(calls);
  });

  it('does not change the ordinary player processor', async () => {
    const p = await player(false);
    p.command('addBuffers', samples());
    p.schedule({ active: true, input: 0, output: 0.06 });
    p.render(20);
    expect(p.calls()).toBeGreaterThan(0);
  });

  it('preserves the upstream sample output when playing at a non-unity tempo', async () => {
    const standard = await player(false);
    const stems = await player(true);
    const channels = samples();
    for (const p of [standard, stems]) {
      p.command('addBuffers', channels);
      p.schedule({ active: true, input: 0, output: 0.06, rate: 0.8 });
    }
    const expected = standard.render(200);
    const actual = stems.render(200);
    for (let channel = 0; channel < 8; channel++) expect(actual[channel]).toEqual(expected[channel]);
  });

  it('fails closed on upstream drift and on a build that bypasses the adapter', async () => {
    await expect(adaptStemUnitySource(upstream + '\n')).rejects.toThrow('wrapper changed');
    const hook = stemUnityPlayback().generateBundle;
    if (typeof hook !== 'function') throw new Error('Expected a build guard');
    const bundle = { 'player.js': { type: 'chunk', modules: { '/repo/packages/engine/src/stem-deck.ts': {} } } };
    expect(() => hook.call({ error: (message: string) => { throw new Error(message); } } as never,
      {} as never, bundle as never, false)).toThrow('without its checked unity playback adapter');
  });
});
