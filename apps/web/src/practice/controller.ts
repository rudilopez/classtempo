import { normalizePracticeSettings, selectedPracticeSection, type PracticeSettings, type PracticeSection } from './settings';

export type PracticePhase = 'idle' | 'preparing' | 'delay' | 'playing' | 'gap' | 'complete' | 'error';

export interface PracticeState {
  phase: PracticePhase;
  /** Current pass; starts at one when playback begins. */
  pass: number;
  remainingSeconds: number;
}

export interface PracticeTransport {
  seek(seconds: number): void;
  pause(): void;
  play(): void | Promise<void>;
}

export interface PracticeTimers {
  now(): number;
  setTimeout(callback: () => void, delayMs: number): unknown;
  clearTimeout(handle: unknown): void;
}

export interface PracticeControllerOptions {
  transport: PracticeTransport;
  timers?: PracticeTimers;
  onState?: (state: PracticeState) => void;
  onError?: (error: unknown) => void;
}

export interface PracticeStart {
  settings: PracticeSettings;
  duration: number;
  /** Resume the first pass inside the selected section. Later passes always restart at A. */
  position?: number;
  /** Called synchronously in the initiating gesture, before any timer is scheduled. */
  prepare?: () => void | Promise<void>;
}

export interface PracticeController {
  start(options: PracticeStart): void;
  tick(position: number): void;
  /** Cancels pending work. The caller controls whether its transport also pauses. */
  cancel(): void;
  getState(): PracticeState;
  dispose(): void;
}

const browserTimers: PracticeTimers = {
  now: () => Date.now(),
  setTimeout: (callback, delay) => globalThis.setTimeout(callback, delay),
  clearTimeout: (handle) => globalThis.clearTimeout(handle as ReturnType<typeof setTimeout>),
};

/**
 * Position-driven section player. Call tick from the transport's progress/ended callback.
 * Cancel before manual seeks, cue launches, loads, pauses and teardown. Scheduled playback
 * requires a transport that was already unlocked by a user gesture. A delayed first native
 * video play is not guaranteed by iOS; the host must prime it or disable delay for that source.
 */
export function createPracticeController(options: PracticeControllerOptions): PracticeController {
  const timers = options.timers ?? browserTimers;
  let state: PracticeState = { phase: 'idle', pass: 0, remainingSeconds: 0 };
  let timer: unknown = null;
  let generation = 0;
  let disposed = false;
  let settings: PracticeSettings | null = null;
  let section: PracticeSection | null = null;
  let firstPosition: number | null = null;

  const update = (next: Partial<PracticeState>) => {
    state = { ...state, ...next };
    options.onState?.({ ...state });
  };
  const clearTimer = () => {
    if (timer !== null) timers.clearTimeout(timer);
    timer = null;
  };
  const cancel = () => {
    generation++;
    clearTimer();
    settings = null;
    section = null;
    firstPosition = null;
    update({ phase: 'idle', pass: 0, remainingSeconds: 0 });
  };
  const fail = (error: unknown, token: number) => {
    if (token !== generation || disposed) return;
    generation++;
    clearTimer();
    try { options.transport.pause(); } catch { /* Preserve the original playback error. */ }
    update({ phase: 'error', remainingSeconds: 0 });
    options.onError?.(error);
  };
  const playPass = (token: number) => {
    if (token !== generation || disposed) return;
    try {
      if (section) options.transport.seek(state.pass === 0 && firstPosition !== null ? firstPosition : section.start);
      update({ phase: 'playing', pass: state.pass + 1, remainingSeconds: 0 });
      const playing = options.transport.play();
      if (playing) void playing.catch((error: unknown) => fail(error, token));
    } catch (error) { fail(error, token); }
  };
  const wait = (phase: 'delay' | 'gap', seconds: number, token: number) => {
    const deadline = timers.now() + seconds * 1000;
    update({ phase, remainingSeconds: seconds });
    const step = () => {
      timer = null;
      if (token !== generation || disposed) return;
      const remaining = Math.max(0, (deadline - timers.now()) / 1000);
      if (remaining <= 0) { playPass(token); return; }
      update({ remainingSeconds: Math.ceil(remaining * 10) / 10 });
      timer = timers.setTimeout(step, Math.min(100, remaining * 1000));
    };
    timer = timers.setTimeout(step, Math.min(100, seconds * 1000));
  };

  return {
    start: (start) => {
      if (disposed) return;
      cancel();
      const token = generation;
      settings = normalizePracticeSettings(start.settings, start.duration);
      section = settings.mode === 'off' ? null : selectedPracticeSection(settings);
      firstPosition = section && typeof start.position === 'number' && Number.isFinite(start.position)
        && start.position >= section.start && start.position < section.end ? start.position : null;
      const begin = () => {
        if (token !== generation || disposed || !settings) return;
        if (settings.delaySeconds > 0) wait('delay', settings.delaySeconds, token);
        else playPass(token);
      };
      try {
        const prepared = start.prepare?.();
        if (prepared) {
          update({ phase: 'preparing' });
          void prepared.then(begin, (error: unknown) => fail(error, token));
        } else begin();
      } catch (error) { fail(error, token); }
    },
    tick: (position) => {
      if (disposed || state.phase !== 'playing' || !settings || !section || !Number.isFinite(position) || position < section.end) return;
      const token = generation;
      // Change phase before calling pause: synchronous transport events can call tick again.
      const repeat = settings.mode === 'repeat' && (settings.repetitions === null || state.pass < settings.repetitions);
      const endpoint = section.end;
      update({ phase: repeat ? 'gap' : 'complete', remainingSeconds: 0 });
      try {
        options.transport.pause();
        // A transport may report its scheduled pause slightly before/after B. Park at the exact
        // endpoint, but never overwrite a manual action dispatched by a synchronous pause event.
        if (token !== generation || disposed) return;
        options.transport.seek(endpoint);
      } catch (error) { fail(error, token); return; }
      if (!repeat || token !== generation || disposed) return;
      if (settings.gapSeconds > 0) wait('gap', settings.gapSeconds, token);
      else playPass(token);
    },
    cancel,
    getState: () => ({ ...state }),
    dispose: () => { cancel(); disposed = true; },
  };
}
