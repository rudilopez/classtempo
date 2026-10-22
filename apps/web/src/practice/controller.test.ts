import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createPracticeController, type PracticeState } from './controller';
import { defaultPracticeSettings, type PracticeSettings } from './settings';

function setup(settings: Partial<PracticeSettings> = {}) {
  const transport = { seek: vi.fn<(position: number) => void>(), pause: vi.fn<() => void>(), play: vi.fn<() => void | Promise<void>>() };
  const states: PracticeState[] = [];
  const onError = vi.fn<(error: unknown) => void>();
  const controller = createPracticeController({ transport, onState: (state) => states.push(state), onError });
  const config: PracticeSettings = {
    ...defaultPracticeSettings(),
    sections: [{ id: 'chorus', name: 'Chorus', start: 10, end: 20 }],
    selectedSectionId: 'chorus',
    mode: 'repeat',
    ...settings,
  };
  return { controller, transport, states, onError, start: () => controller.start({ settings: config, duration: 60 }), config };
}

describe('practice playback', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('prepares synchronously in the initiating gesture and waits before playing', () => {
    const { controller, transport, config } = setup({ delaySeconds: 5 });
    const prepare = vi.fn();
    controller.start({ settings: config, duration: 60, prepare });
    expect(prepare).toHaveBeenCalledOnce();
    expect(controller.getState()).toEqual({ phase: 'delay', pass: 0, remainingSeconds: 5 });
    expect(transport.play).not.toHaveBeenCalled();
    vi.advanceTimersByTime(4900);
    expect(transport.play).not.toHaveBeenCalled();
    vi.advanceTimersByTime(100);
    expect(transport.seek).toHaveBeenCalledWith(10);
    expect(transport.play).toHaveBeenCalledOnce();
    expect(controller.getState()).toEqual({ phase: 'playing', pass: 1, remainingSeconds: 0 });
  });

  it('stops once at the section end without repeated pause callbacks', () => {
    const { controller, transport, start } = setup({ mode: 'once' });
    start();
    controller.tick(19.99);
    expect(transport.pause).not.toHaveBeenCalled();
    controller.tick(20);
    controller.tick(20.2);
    expect(transport.pause).toHaveBeenCalledOnce();
    expect(transport.seek).toHaveBeenLastCalledWith(20);
    expect(controller.getState().phase).toBe('complete');
    vi.advanceTimersByTime(30000);
    expect(transport.play).toHaveBeenCalledOnce();
  });

  it('plays exactly the finite total, with a gap between each pass', () => {
    const { controller, transport, start } = setup({ repetitions: 3, gapSeconds: 2 });
    start();
    controller.tick(20);
    expect(controller.getState()).toEqual({ phase: 'gap', pass: 1, remainingSeconds: 2 });
    expect(transport.seek).toHaveBeenLastCalledWith(20);
    // Duplicate progress / ended events cannot queue another restart.
    controller.tick(60);
    vi.advanceTimersByTime(2000);
    expect(transport.play).toHaveBeenCalledTimes(2);
    controller.tick(20);
    vi.advanceTimersByTime(2000);
    expect(transport.play).toHaveBeenCalledTimes(3);
    controller.tick(20);
    expect(controller.getState().phase).toBe('complete');
    vi.advanceTimersByTime(30000);
    expect(transport.play).toHaveBeenCalledTimes(3);
  });

  it('cancels pending countdown or gap on a manual action without pausing the new action', () => {
    const { controller, transport, start } = setup({ delaySeconds: 3, gapSeconds: 2 });
    start();
    controller.cancel();
    vi.advanceTimersByTime(3000);
    expect(transport.play).not.toHaveBeenCalled();
    expect(transport.pause).not.toHaveBeenCalled();
    start();
    vi.advanceTimersByTime(3000);
    controller.tick(20);
    controller.cancel();
    transport.seek(45);
    vi.advanceTimersByTime(30000);
    expect(transport.seek).toHaveBeenLastCalledWith(45);
    expect(transport.play).toHaveBeenCalledOnce();
  });

  it('replaces a pending start without keeping its old timer', () => {
    const { controller, transport, config } = setup({ delaySeconds: 10 });
    controller.start({ settings: config, duration: 60 });
    controller.start({ settings: { ...config, delaySeconds: 1, sections: [{ id: 'chorus', name: 'New', start: 30, end: 40 }] }, duration: 60 });
    vi.advanceTimersByTime(20000);
    expect(transport.play).toHaveBeenCalledOnce();
    expect(transport.seek).toHaveBeenCalledExactlyOnceWith(30);
  });

  it('disposal makes the controller inert and clears all scheduled work', () => {
    const { controller, transport, start } = setup({ delaySeconds: 3 });
    start();
    controller.dispose();
    vi.advanceTimersByTime(30000);
    start();
    controller.tick(20);
    expect(transport.play).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('guards asynchronous preparation against cancellation and reports failures', async () => {
    const { controller, transport, config, onError } = setup({ delaySeconds: 3 });
    let resolve: (() => void) | undefined;
    controller.start({ settings: config, duration: 60, prepare: () => new Promise<void>((done) => { resolve = done; }) });
    expect(controller.getState().phase).toBe('preparing');
    controller.cancel();
    resolve?.();
    await Promise.resolve();
    vi.advanceTimersByTime(30000);
    expect(transport.play).not.toHaveBeenCalled();
    const error = new Error('Cannot unlock');
    controller.start({ settings: config, duration: 60, prepare: () => Promise.reject(error) });
    await Promise.resolve();
    expect(onError).toHaveBeenCalledWith(error);
    expect(controller.getState().phase).toBe('error');
    expect(vi.getTimerCount()).toBe(0);
  });

  it('starts the delay after preparation, and cancels a rejected playback promise', async () => {
    const { controller, transport, config, onError } = setup({ delaySeconds: 3 });
    let resolve: (() => void) | undefined;
    controller.start({ settings: config, duration: 60, prepare: () => new Promise<void>((done) => { resolve = done; }) });
    vi.advanceTimersByTime(10000);
    expect(transport.play).not.toHaveBeenCalled();
    resolve?.();
    await Promise.resolve();
    const error = new Error('Playback not allowed');
    transport.play.mockReturnValueOnce(Promise.reject(error));
    vi.advanceTimersByTime(3000);
    await Promise.resolve();
    expect(onError).toHaveBeenCalledWith(error);
    expect(controller.getState().phase).toBe('error');
    controller.tick(20);
    vi.advanceTimersByTime(30000);
    expect(transport.play).toHaveBeenCalledOnce();
  });

  it('does not let an old rejected play interrupt a newer playback session', async () => {
    const { controller, transport, start, onError } = setup();
    let reject: ((error: Error) => void) | undefined;
    transport.play.mockReturnValueOnce(new Promise<void>((_resolve, fail) => { reject = fail; }));
    start();
    controller.cancel();
    start();
    reject?.(new Error('Old playback request'));
    await Promise.resolve();
    expect(controller.getState().phase).toBe('playing');
    expect(onError).not.toHaveBeenCalled();
    expect(transport.pause).not.toHaveBeenCalled();
  });

  it('full-track mode does not seek to or enforce a saved section', () => {
    const { controller, transport, start } = setup({ mode: 'off' });
    start();
    expect(transport.seek).not.toHaveBeenCalled();
    controller.tick(20);
    expect(transport.pause).not.toHaveBeenCalled();
  });

  it('resumes the first pass inside a section and restarts later passes at A', () => {
    const { controller, transport, config } = setup({ repetitions: 2 });
    controller.start({ settings: config, duration: 60, position: 15 });
    expect(transport.seek).toHaveBeenLastCalledWith(15);
    controller.tick(20);
    expect(transport.seek).toHaveBeenLastCalledWith(10);
    expect(controller.getState().pass).toBe(2);
    controller.tick(20);
    expect(controller.getState().phase).toBe('complete');
  });

  it.each([0, 20, 35, NaN, Infinity])('starts at A if the requested resume position %s is outside the section', (position) => {
    const { controller, transport, config } = setup();
    controller.start({ settings: config, duration: 60, position });
    expect(transport.seek).toHaveBeenLastCalledWith(10);
  });

  it('sets phase before pausing so synchronous progress events cannot recurse', () => {
    const { controller, transport, start } = setup({ repetitions: 2 });
    transport.pause.mockImplementation(() => controller.tick(20));
    start();
    controller.tick(20);
    expect(transport.pause).toHaveBeenCalledOnce();
    expect(transport.play).toHaveBeenCalledTimes(2);
  });

  it('does not overwrite a manual seek triggered during the boundary pause', () => {
    const { controller, transport, start } = setup({ gapSeconds: 2 });
    transport.pause.mockImplementation(() => {
      controller.cancel();
      transport.seek(45);
    });
    start();
    controller.tick(20);
    expect(transport.seek).toHaveBeenLastCalledWith(45);
    expect(controller.getState().phase).toBe('idle');
    vi.advanceTimersByTime(3000);
    expect(transport.play).toHaveBeenCalledOnce();
  });
});
