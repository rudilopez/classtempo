import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Engine } from './engine';
import { StemDeck } from './stem-deck';

/** A linear audio graph: evaluates a unit input's settled gain at the destination. */
class FakeNode {
  readonly outputs: FakeNode[] = [];
  readonly gain: { value: number; setTargetAtTime: (value: number) => void };

  constructor(_context?: unknown, options?: { gain?: number }) {
    this.gain = {
      value: options?.gain ?? 1,
      setTargetAtTime: (value) => { this.gain.value = value; },
    };
  }

  connect(target: FakeNode): FakeNode {
    this.outputs.push(target);
    return target;
  }

  signalAt(destination: FakeNode): number {
    if (this === destination) return 1;
    return this.gain.value * this.outputs.reduce((sum, node) => sum + node.signalAt(destination), 0);
  }
}

vi.mock('./deck', () => ({
  Deck: class {
    readonly output = new FakeNode();
  },
}));

vi.mock('./stretch-deck', () => ({
  StretchDeck: {
    create: async (_context: unknown, destination: FakeNode) => {
      const node = new FakeNode();
      node.connect(destination);
      return { node };
    },
  },
}));

vi.mock('./stem-deck', () => ({
  StemDeck: {
    create: vi.fn(async (_context: unknown, destination: FakeNode) => {
      const node = new FakeNode();
      node.connect(destination);
      return { node };
    }),
  },
}));

class FakeContext {
  readonly destination = new FakeNode();
  readonly currentTime = 0;
  readonly audioWorklet = { addModule: vi.fn(async () => {}) };
}

describe('mode output isolation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal('AudioContext', FakeContext);
    vi.stubGlobal('GainNode', FakeNode);
  });

  it('keeps stems lazy and reuses one deck routed through Talk independently of DJ master', async () => {
    const engine = await Engine.create({ dj: false });
    await engine.getStretchDeck();
    expect(StemDeck.create).not.toHaveBeenCalled();
    const [stems, again] = await Promise.all([engine.getStemDeck(), engine.getStemDeck()]);
    expect(stems).toBe(again);
    expect(StemDeck.create).toHaveBeenCalledTimes(1);
    const output = stems.node as unknown as FakeNode;
    const destination = engine.ctx.destination as unknown as FakeNode;
    engine.setMasterGain(0);
    expect(output.signalAt(destination)).toBeCloseTo(0.9);
    engine.setDancerGain(0.2);
    expect(output.signalAt(destination)).toBeCloseTo(0.18);
    engine.setDancerGain(1);
    expect(output.signalAt(destination)).toBeCloseTo(0.9);
  });

  it('retries a failed lazy stem initialization', async () => {
    const engine = await Engine.create({ dj: false });
    vi.mocked(StemDeck.create).mockRejectedValueOnce(new Error('Worklet unavailable'));
    await expect(engine.getStemDeck()).rejects.toThrow('Worklet unavailable');
    await expect(engine.getStemDeck()).resolves.toBeDefined();
    expect(StemDeck.create).toHaveBeenCalledTimes(2);
  });

  afterEach(() => vi.unstubAllGlobals());

  it('creates a classroom player without loading DJ processors and restores its talk level', async () => {
    const engine = await Engine.create({ dj: false });
    expect(engine.ctx.audioWorklet.addModule).not.toHaveBeenCalled();
    expect(() => engine.decks).toThrow('DJ decks are not enabled');
    const output = (await engine.getStretchDeck()).node as unknown as FakeNode;
    const destination = engine.ctx.destination as unknown as FakeNode;
    expect(output.signalAt(destination)).toBeCloseTo(0.9);
    engine.setDancerGain(0.2);
    expect(output.signalAt(destination)).toBeCloseTo(0.18);
    engine.setDancerGain(1);
    expect(output.signalAt(destination)).toBeCloseTo(0.9);
  });

  it('keeps Dancer audible when the saved DJ master is muted and preserves that DJ mute', async () => {
    const engine = await Engine.create();
    const destination = engine.ctx.destination as unknown as FakeNode;
    const dancer = await engine.getStretchDeck();
    const dancerOutput = dancer.node as unknown as FakeNode;
    const djOutput = engine.decks[0].output as unknown as FakeNode;
    expect(djOutput.signalAt(destination)).toBeGreaterThan(0);
    expect(dancerOutput.signalAt(destination)).toBeCloseTo(0.9);

    engine.setMasterGain(0);
    engine.setCrossfader(1);
    expect(djOutput.signalAt(destination)).toBe(0);
    expect(dancerOutput.signalAt(destination)).toBeCloseTo(0.9);
    expect(await engine.getStretchDeck()).toBe(dancer);
    expect(engine.master.gain.value).toBe(0);

    engine.setMasterGain(0.4);
    engine.setCrossfader(-1);
    expect(djOutput.signalAt(destination)).toBeCloseTo(0.4);
    expect(dancerOutput.signalAt(destination)).toBeCloseTo(0.9);
  });
});
