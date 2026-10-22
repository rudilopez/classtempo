import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createWakeLock } from './wakeLock';

class FakeSentinel extends EventTarget {
  released = false;
  async release(): Promise<void> {
    if (this.released) return;
    this.released = true;
    this.dispatchEvent(new Event('release'));
  }
}

function fakeDocument() {
  return Object.assign(new EventTarget(), { visibilityState: 'visible' as DocumentVisibilityState });
}

describe('createWakeLock', () => {
  let doc: ReturnType<typeof fakeDocument>;
  let sentinels: FakeSentinel[];
  let request: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    doc = fakeDocument();
    sentinels = [];
    request = vi.fn(async () => {
      const s = new FakeSentinel();
      sentinels.push(s);
      return s;
    });
    vi.stubGlobal('document', doc);
    vi.stubGlobal('navigator', { wakeLock: { request } });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  const setVisibility = (state: DocumentVisibilityState) => {
    doc.visibilityState = state;
    doc.dispatchEvent(new Event('visibilitychange'));
  };

  it('is unsupported without the API', async () => {
    vi.stubGlobal('navigator', {});
    const lock = createWakeLock();
    expect(lock.supported).toBe(false);
    await expect(lock.enable()).resolves.toBe(false);
    expect(lock.active).toBe(false);
    await expect(lock.disable()).resolves.toBeUndefined();
  });

  it('acquires a screen lock and releases it on disable', async () => {
    const lock = createWakeLock();
    expect(lock.supported).toBe(true);
    await expect(lock.enable()).resolves.toBe(true);
    expect(request).toHaveBeenCalledWith('screen');
    expect(lock.active).toBe(true);
    await lock.disable();
    expect(lock.active).toBe(false);
    expect(sentinels[0]?.released).toBe(true);
  });

  it('does not request twice while held or in flight', async () => {
    const lock = createWakeLock();
    await Promise.all([lock.enable(), lock.enable()]);
    await lock.enable();
    expect(request).toHaveBeenCalledTimes(1);
  });

  it('re-acquires when the page becomes visible again while enabled', async () => {
    const lock = createWakeLock();
    await lock.enable();
    setVisibility('hidden');
    await sentinels[0]?.release(); // the browser drops it when hidden
    expect(lock.active).toBe(false);
    setVisibility('visible');
    await vi.waitFor(() => expect(lock.active).toBe(true));
    expect(request).toHaveBeenCalledTimes(2);
  });

  it('stays off after disable', async () => {
    const lock = createWakeLock();
    await lock.enable();
    await lock.disable();
    setVisibility('hidden');
    setVisibility('visible');
    await Promise.resolve();
    expect(request).toHaveBeenCalledTimes(1);
    expect(lock.active).toBe(false);
  });

  it('releases a lock granted after disable', async () => {
    const lock = createWakeLock();
    const enabling = lock.enable();
    await lock.disable();
    await expect(enabling).resolves.toBe(false);
    expect(lock.active).toBe(false);
    expect(sentinels[0]?.released).toBe(true);
  });

  it('resolves false when the request is refused', async () => {
    request.mockRejectedValueOnce(new DOMException('no', 'NotAllowedError'));
    const lock = createWakeLock();
    await expect(lock.enable()).resolves.toBe(false);
    expect(lock.active).toBe(false);
    await expect(lock.enable()).resolves.toBe(true);
  });

  it('reports grants and refusals through onChange', async () => {
    const onChange = vi.fn();
    request.mockRejectedValueOnce(new DOMException('no', 'NotAllowedError'));
    const lock = createWakeLock({ onChange });
    await lock.enable();
    expect(onChange.mock.calls).toEqual([[false]]);
    await lock.enable();
    expect(onChange.mock.calls).toEqual([[false], [true]]);
    await lock.disable();
    expect(onChange).toHaveBeenCalledTimes(2);
  });

  it('reports a lock the system drops while visible', async () => {
    const onChange = vi.fn();
    const lock = createWakeLock({ onChange });
    await lock.enable();
    await sentinels[0]?.release(); // e.g. battery saver / Low Power Mode turned on
    expect(lock.active).toBe(false);
    expect(onChange.mock.calls).toEqual([[true], [false]]);
  });

  it('does not report a drop while hidden, then reports the re-acquire result', async () => {
    const onChange = vi.fn();
    const lock = createWakeLock({ onChange });
    await lock.enable();
    setVisibility('hidden');
    await sentinels[0]?.release();
    expect(onChange.mock.calls).toEqual([[true]]);
    request.mockRejectedValueOnce(new DOMException('no', 'NotAllowedError'));
    setVisibility('visible');
    await vi.waitFor(() => expect(onChange.mock.calls).toEqual([[true], [false]]));
    expect(lock.active).toBe(false);
    setVisibility('hidden');
    setVisibility('visible');
    await vi.waitFor(() => expect(onChange.mock.calls).toEqual([[true], [false], [true]]));
    expect(lock.active).toBe(true);
  });

  it('survives a throwing onChange', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const lock = createWakeLock({
      onChange: () => {
        throw new Error('boom');
      },
    });
    await expect(lock.enable()).resolves.toBe(true);
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });
});
