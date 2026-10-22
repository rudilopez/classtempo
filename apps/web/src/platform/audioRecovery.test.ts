import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { watchAudioContext } from './audioRecovery';

/** AudioContext stand-in whose resume() succeeds only when `resumable`. */
class FakeContext extends EventTarget {
  state: AudioContextState = 'running';
  resumable = true;
  resume = vi.fn(async () => {
    if (this.resumable) this.setState('running');
  });

  setState(state: AudioContextState): void {
    this.state = state;
    this.dispatchEvent(new Event('statechange'));
  }
}

describe('watchAudioContext', () => {
  let ctx: FakeContext;
  let doc: EventTarget & { visibilityState: DocumentVisibilityState };
  let shouldRun: boolean;
  let onNeedsGesture: ReturnType<typeof vi.fn>;
  let stop: () => void;

  const watch = (onResumeAttempt?: () => void) => {
    stop = watchAudioContext(ctx as unknown as AudioContext, {
      shouldBeRunning: () => shouldRun,
      onNeedsGesture,
      onResumeAttempt,
    });
  };

  const setVisibility = (state: DocumentVisibilityState) => {
    doc.visibilityState = state;
    doc.dispatchEvent(new Event('visibilitychange'));
  };

  beforeEach(() => {
    vi.useFakeTimers();
    ctx = new FakeContext();
    doc = Object.assign(new EventTarget(), { visibilityState: 'visible' as DocumentVisibilityState });
    vi.stubGlobal('document', doc);
    shouldRun = true;
    onNeedsGesture = vi.fn();
  });

  afterEach(() => {
    stop();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('resumes an interrupted context without asking for a tap when that works', async () => {
    const onResumeAttempt = vi.fn();
    watch(onResumeAttempt);
    ctx.setState('interrupted');
    expect(ctx.resume).toHaveBeenCalledTimes(1);
    expect(onResumeAttempt).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1000);
    expect(ctx.state).toBe('running');
    expect(onNeedsGesture).not.toHaveBeenCalled();
  });

  it('asks for a tap when the context is still stalled after the grace period', async () => {
    ctx.resumable = false;
    watch();
    ctx.setState('suspended');
    await vi.advanceTimersByTimeAsync(400);
    expect(onNeedsGesture).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(200);
    expect(onNeedsGesture).toHaveBeenCalledExactlyOnceWith(true);
  });

  it('reports false once the context runs again', async () => {
    ctx.resumable = false;
    watch();
    ctx.setState('interrupted');
    await vi.advanceTimersByTimeAsync(600);
    ctx.setState('running'); // e.g. the overlay's tap resumed it
    expect(onNeedsGesture.mock.calls).toEqual([[true], [false]]);
    ctx.setState('running');
    expect(onNeedsGesture).toHaveBeenCalledTimes(2);
  });

  it('retries when the page becomes visible again', async () => {
    ctx.resumable = false;
    watch();
    ctx.setState('interrupted');
    await vi.advanceTimersByTimeAsync(600);
    ctx.resumable = true;
    setVisibility('hidden');
    expect(ctx.resume).toHaveBeenCalledTimes(1);
    setVisibility('visible');
    expect(ctx.resume).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(600);
    expect(onNeedsGesture.mock.calls).toEqual([[true], [false]]);
  });

  it('withdraws the tap request when playback was paused meanwhile', async () => {
    ctx.resumable = false;
    watch();
    ctx.setState('interrupted');
    await vi.advanceTimersByTimeAsync(600);
    expect(onNeedsGesture).toHaveBeenCalledExactlyOnceWith(true);
    setVisibility('hidden');
    shouldRun = false; // e.g. paused from the lock screen
    setVisibility('visible');
    expect(onNeedsGesture.mock.calls).toEqual([[true], [false]]);
    await vi.advanceTimersByTimeAsync(1000);
    expect(ctx.resume).toHaveBeenCalledTimes(1);
    expect(onNeedsGesture).toHaveBeenCalledTimes(2);
  });

  it('drops a pending resume attempt when playback is paused before it settles', async () => {
    ctx.resumable = false;
    watch();
    ctx.setState('suspended');
    shouldRun = false;
    ctx.setState('interrupted');
    await vi.advanceTimersByTimeAsync(1000);
    expect(onNeedsGesture).not.toHaveBeenCalled();
  });

  it('leaves a context alone that should not be running', async () => {
    shouldRun = false;
    watch();
    ctx.setState('suspended');
    setVisibility('visible');
    await vi.advanceTimersByTimeAsync(1000);
    expect(ctx.resume).not.toHaveBeenCalled();
    expect(onNeedsGesture).not.toHaveBeenCalled();
  });

  it('ignores a closed context', async () => {
    watch();
    ctx.setState('closed');
    await vi.advanceTimersByTimeAsync(1000);
    expect(ctx.resume).not.toHaveBeenCalled();
    expect(onNeedsGesture).not.toHaveBeenCalled();
  });

  it('survives a throwing resume()', async () => {
    ctx.resume.mockImplementation(() => {
      throw new DOMException('closed', 'InvalidStateError');
    });
    watch();
    expect(() => ctx.setState('suspended')).not.toThrow();
    await vi.advanceTimersByTimeAsync(600);
    expect(onNeedsGesture).toHaveBeenCalledWith(true);
  });

  it('stops listening after unsubscribe', async () => {
    ctx.resumable = false;
    watch();
    ctx.setState('suspended');
    stop();
    await vi.advanceTimersByTimeAsync(1000);
    ctx.setState('interrupted');
    setVisibility('visible');
    await vi.advanceTimersByTimeAsync(1000);
    expect(ctx.resume).toHaveBeenCalledTimes(1);
    expect(onNeedsGesture).not.toHaveBeenCalled();
  });
});
