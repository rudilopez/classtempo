import type { Plugin } from 'vite';

const TARGET = '/node_modules/signalsmith-stretch/SignalsmithStretch.mjs';
// signalsmith-stretch@1.3.2. Its stringified worklet must keep these helpers inside the processor.
const UPSTREAM_SHA256 = '97530b11d5bc01015af4cde40d6aa55ff10c40aa1294ca4c8c5762027d517a46';

const METHODS = String.raw`
		classTempoUnityBypass = false;
		classTempoTimeline = [{active: false, input: 0, output: 0, rate: 1, semitones: 0, formantSemitones: 0, loopStart: 0, loopEnd: 0}];
		classTempoSkipped = false;

		classTempoRemember(segment, discardFrom) {
			while (this.classTempoTimeline.length && this.classTempoTimeline[this.classTempoTimeline.length - 1].output >= discardFrom) this.classTempoTimeline.pop();
			this.classTempoTimeline.push({...segment});
		}

		classTempoPlain(segment) {
			return !segment.active || (segment.rate === 1 && segment.semitones === 0 && segment.formantSemitones === 0);
		}

		classTempoCanSkip(frames) {
			const timeline = this.classTempoTimeline;
			while (timeline.length > 1 && Math.round(timeline[1].output*sampleRate) <= Math.round(currentTime*sampleRate)) timeline.shift();
			// Keep the normal stretcher warm for an upcoming tempo change, including its output latency.
			const until = currentTime + frames/sampleRate + this.outputLatencySeconds;
			return timeline.every(segment => segment.output > until || this.classTempoPlain(segment));
		}

		classTempoCopyPlain(outputs) {
			const timeline = this.classTempoTimeline;
			let segmentIndex = 0;
			for (let frame = 0; frame < outputs[0].length; frame++) {
				const time = currentTime + frame/sampleRate;
				const absoluteFrame = Math.round(currentTime*sampleRate) + frame;
				while (segmentIndex + 1 < timeline.length && Math.round(timeline[segmentIndex + 1].output*sampleRate) <= absoluteFrame) segmentIndex++;
				const segment = timeline[segmentIndex];
				if (!this.classTempoPlain(segment)) continue;
				let position = segment.input + (time - segment.output)*segment.rate;
				const loopLength = segment.loopEnd - segment.loopStart;
				if (loopLength > 0 && position >= segment.loopEnd) position = segment.loopStart + (position - segment.loopStart)%loopLength;
				let sourceFrame = Math.round(position*sampleRate) - this.audioBuffersStart;
				let source = null;
				if (segment.active && absoluteFrame >= Math.round(segment.output*sampleRate) && sourceFrame >= 0) {
					for (const buffer of this.audioBuffers) {
						if (sourceFrame < buffer[0].length) { source = buffer; break; }
						sourceFrame -= buffer[0].length;
					}
				}
				for (let channel = 0; channel < outputs.length; channel++) outputs[channel][frame] = source ? source[channel%source.length][sourceFrame] : 0;
			}
		}

		classTempoTick(frames) {
			this.timeIntervalCounter -= frames;
			if (this.timeIntervalCounter <= 0) {
				this.timeIntervalCounter = this.timeIntervalSamples;
				const segment = this.classTempoTimeline[0];
				if (segment.active) this.port.postMessage(['time', segment.input + Math.max(0, currentTime - segment.output)*segment.rate]);
			}
		}
`;

/** Preserve transferred PCM at unity tempo; only the explicitly opted-in stem node changes behavior. */
export async function adaptStemUnitySource(source: string): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(source)));
  const hash = [...digest].map((byte) => byte.toString(16).padStart(2, '0')).join('');
  if (hash !== UPSTREAM_SHA256) throw new Error('The pinned Signalsmith wrapper changed. Review the stem playback adapter before building ClassTempo.');
  return source
    .replace('\t\t\tsuper(options);', '\t\t\tsuper(options);\n\t\t\tthis.classTempoUnityBypass = options.processorOptions?.classTempoUnityBypass === true;')
    .replace('\t\t\t\t\treturn obj;', '\t\t\t\t\tif (this.classTempoUnityBypass) this.classTempoRemember(obj, outputTime);\n\t\t\t\t\treturn obj;')
    .replace('\t\tprocess(inputList, outputList, parameters) {', METHODS + '\n\t\tprocess(inputList, outputList, parameters) {')
    .replace('\t\t\tif (!outputList[0]?.length) return false;', `\t\t\tif (!outputList[0]?.length) return false;
\t\t\tif (this.classTempoUnityBypass && this.classTempoCanSkip(outputList[0][0].length)) {
\t\t\t\tthis.classTempoCopyPlain(outputList[0]);
\t\t\t\tthis.classTempoTick(outputList[0][0].length);
\t\t\t\tthis.classTempoSkipped = true;
\t\t\t\treturn true;
\t\t\t}
\t\t\tif (this.classTempoUnityBypass && this.classTempoSkipped) {
\t\t\t\tthis.wasmModule._reset();
\t\t\t\tthis.classTempoSkipped = false;
\t\t\t}`)
    .replace('\t\t\t\tchannelBuffer.set(buffer);\n\t\t\t});', '\t\t\t\tchannelBuffer.set(buffer);\n\t\t\t});\n\t\t\tif (this.classTempoUnityBypass) this.classTempoCopyPlain(outputList[0]);');
}

export function stemUnityPlayback(): Plugin {
  let adapted = false;
  return {
    name: 'classtempo-stem-unity-playback',
    enforce: 'pre',
    async transform(source, id) {
      const [path = '', query = ''] = id.replaceAll('\\', '/').split('?');
      if (!path.endsWith(TARGET) || new URLSearchParams(query).has('raw') || new URLSearchParams(query).has('url')) return null;
      const code = await adaptStemUnitySource(source);
      adapted = true;
      return { code, map: null };
    },
    generateBundle(_options, bundle) {
      const playerBuilt = Object.values(bundle).some((output) => output.type === 'chunk' &&
        Object.keys(output.modules).some((id) => id.replaceAll('\\', '/').endsWith('/engine/src/stem-deck.ts')));
      if (playerBuilt && !adapted) this.error('The stem player was built without its checked unity playback adapter.');
    },
  };
}
