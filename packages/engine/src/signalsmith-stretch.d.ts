/**
 * Ambient types for the untyped npm package "signalsmith-stretch" (v1.3.2), written from the
 * main-thread wrapper at the end of node_modules/signalsmith-stretch/SignalsmithStretch.mjs.
 * Every method is a message round-trip to the AudioWorklet and so returns a Promise, including the
 * ones the package README shows as plain calls (`latency()`, `schedule()`).
 */
declare module 'signalsmith-stretch' {
  /** One segment of the node's output-time → input-position map (every field is set on a resolved segment). */
  export interface StretchSegment {
    /** AudioContext time this segment starts at. */
    output: number;
    /** Processing audio. While false the input position holds. */
    active: boolean;
    /** Position in the input buffers (seconds) at `output`. */
    input: number;
    /** Playback rate; 0.5 = half speed. */
    rate: number;
    /** Pitch shift in semitones. */
    semitones: number;
    tonalityHz: number;
    formantSemitones: number;
    formantCompensation: boolean;
    formantBaseHz: number;
    /** Auto-loop section; disabled when loopStart === loopEnd. */
    loopStart: number;
    loopEnd: number;
  }

  /** A change for `schedule()`: omitted fields are inherited from the previous segment. */
  export type StretchSchedule = Partial<StretchSegment>;

  export interface StretchConfig {
    /** STFT block length in ms; 0/null selects `preset`. */
    blockMs?: number | null;
    /** Defaults to blockMs / 4. */
    intervalMs?: number;
    splitComputation?: boolean;
    preset?: 'default' | 'cheaper';
  }

  /** An AudioWorkletNode with the Signalsmith Stretch remote methods attached. */
  export interface StretchNode extends AudioWorkletNode {
    /** Last input time (seconds) reported by the worklet; see `setUpdateInterval`. */
    inputTime: number;
    /**
     * Adds a change at `output` (AudioContext seconds; defaults to the worklet's current time, i.e.
     * immediately) and drops any change scheduled at or after the worklet's current time. A missing
     * `input` continues from the previous segment: its input advanced by elapsed × rate while active,
     * held while inactive.
     */
    schedule(change: StretchSchedule): Promise<StretchSegment>;
    /** AudioBufferSourceNode-style start; an object argument is passed to `schedule` with active defaulting to true. */
    start(
      when?: number | StretchSchedule,
      offset?: number,
      duration?: number,
      rate?: number,
      semitones?: number,
    ): Promise<StretchSegment>;
    stop(when?: number): Promise<StretchSegment>;
    /**
     * Appends one array per channel (equal lengths) after the existing buffers; `transfer` moves the
     * backing ArrayBuffers instead of copying them. Resolves to the new end time in seconds.
     */
    addBuffers(buffers: Float32Array[], transfer?: Transferable[]): Promise<number>;
    /** No argument: drops everything and resets the end time to 0. With a time: drops whole buffers that end before it. */
    dropBuffers(toSeconds?: number): Promise<{ start: number; end: number }>;
    /** Interval between `inputTime` reports while active; `callback` receives each reported value. */
    setUpdateInterval(seconds: number, callback?: (inputTime: number) => void): Promise<void>;
    /** Input + output latency of the stretcher in seconds (0.12 with the default preset). */
    latency(): Promise<number>;
    configure(config: StretchConfig): Promise<void>;
  }

  /**
   * Creates a StretchNode, registering the worklet module on first use. Default `options`:
   * { numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [2] }.
   */
  const SignalsmithStretch: (ctx: AudioContext, options?: AudioWorkletNodeOptions) => Promise<StretchNode>;
  export default SignalsmithStretch;
}
