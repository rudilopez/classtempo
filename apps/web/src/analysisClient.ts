import type { AnalysisResult } from '@mixdeck/analysis';

type Pending = { resolve: (r: AnalysisResult) => void; reject: (e: unknown) => void };

/** One shared Worker; requests are matched by id. Transfers the mono buffer in and the peaks out. */
class AnalysisClient {
  private worker: Worker | null = null;
  private nextId = 1;
  private pending = new Map<number, Pending>();

  private get w(): Worker {
    if (!this.worker) {
      this.worker = new Worker(new URL('./analysis.worker.ts', import.meta.url), { type: 'module' });
      this.worker.onmessage = (e: MessageEvent<{ id: number; result: AnalysisResult }>) => {
        const p = this.pending.get(e.data.id);
        if (!p) return;
        this.pending.delete(e.data.id);
        p.resolve(e.data.result);
      };
      this.worker.onerror = (e) => {
        for (const p of this.pending.values()) p.reject(e);
        this.pending.clear();
      };
    }
    return this.worker;
  }

  analyze(mono: Float32Array, sampleRate: number): Promise<AnalysisResult> {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.w.postMessage({ id, mono, sampleRate }, [mono.buffer]);
    });
  }
}

export const analysis = new AnalysisClient();
