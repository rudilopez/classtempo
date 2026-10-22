import { analyze } from '@mixdeck/analysis';

export interface AnalysisRequest {
  id: number;
  mono: Float32Array;
  sampleRate: number;
}

self.onmessage = (e: MessageEvent<AnalysisRequest>) => {
  const { id, mono, sampleRate } = e.data;
  const result = analyze(mono, sampleRate);
  self.postMessage({ id, result }, [result.peaks.buffer]);
};
