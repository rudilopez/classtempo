/** Passive bookkeeping only. Importing this module never creates or starts an audio context. */
let localContext: AudioContext | null = null;

export function registerLocalAudioContext(context: AudioContext): void {
  localContext = context;
}

/** Distinguishes a fresh streaming-only page from one that also created the local engine. */
export function localAudioContextDetails(): {
  created: boolean;
  state: AudioContextState | null;
  sampleRate: number | null;
} {
  return {
    created: localContext !== null,
    state: localContext?.state ?? null,
    sampleRate: localContext?.sampleRate ?? null,
  };
}
