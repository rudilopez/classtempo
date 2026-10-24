# ClassTempo local stems

The production feature uses **Spleeter 4-stem**, separately from the historical HTDemucs research benchmark.
It produces vocals, drums, bass and other instruments from a local song. Instrumental is drums + bass + other;
Acapella is vocals. It does not claim separate kick or hi-hat tracks. Songs are processed on the device and
are never uploaded. Preparation requires an explicit action; ordinary playback never fetches an AI model.

## Model provenance and permissions

The upstream model is [Deezer Spleeter](https://github.com/deezer/spleeter), trained on Deezer's internal dataset.
The authors explicitly state that source code **and pretrained models** are distributed under MIT in their
[published JOSS paper](https://joss.theoj.org/papers/10.21105/joss.02154) and
[the paper in their own repository](https://github.com/deezer/spleeter/blob/master/paper.md).
This is the weight-license evidence used here, not an assumption from a third-party model-card badge.
The README's license sentence names code only; the unanswered clarification requests
[#957](https://github.com/deezer/spleeter/issues/957) and
[#959](https://github.com/deezer/spleeter/issues/959) remain visible. We found no upstream withdrawal of the
paper's explicit pretrained-model MIT statement. The feature preserves that attribution and does not use
the research-restricted Demucs weights.

The ONNX conversion is [Best-Practice/spleeter-4stems-onnx](https://huggingface.co/Best-Practice/spleeter-4stems-onnx),
with [reproducible conversion source](https://github.com/madewith-bestpractice/spleeter-4stems-onnx).
The conversion derives from Xiaomi/sherpa-onnx under Apache-2.0; its U-Net activation functions were changed
to ELU to match Spleeter 4-stem. Include the separate model and conversion notices at
`apps/web/public/licenses/spleeter-stems.txt`. ClassTempo's FFT and chunked overlap-add implementation is original.

Pinned Hugging Face revision: `486643021f18a4d057d282fff1d11b89a30e9887`.
Each artifact is fetched from `https://huggingface.co/Best-Practice/spleeter-4stems-onnx/resolve/<revision>/<file>`.

| File | Bytes | SHA-256 |
| --- | ---: | --- |
| vocals.fp16.onnx | 19,714,141 | db47148ab1c52709ce694893f532c91abfe3edc4d46238939570e036a22878ca |
| drums.fp16.onnx | 19,714,140 | 7ae4002e5633634674f74dc3356d5875b0da894d59ce0f60e844bb8f9cb8aa92 |
| bass.fp16.onnx | 19,714,139 | ba4c4949a27222492cca49859901a873b4b71461dc48c7c5a51f93d31eb11f55 |
| other.fp16.onnx | 19,714,140 | 3cc59116cb7195946ab9596d8ca25984d09c0f8a70db8cf85d063132f97bc61d |

Total models: 78,856,560 bytes, plus the existing ONNX Runtime Web runtime. No model files are committed.
Every cache read and download is checked against size and SHA-256 before inference; corrupt cached entries
are removed. Failed cache persistence permits current preparation but is reported, not called an offline save.

## Signal and worker contract

- Input: 44.1 kHz stereo Float32 PCM, up to **4:30**, with a 100 MB source-file guard. Longer songs fail before
  downloading the model. These limits apply only to stems preparation, not ordinary song/video playback.
- Each independent graph takes `x float32 [2,1,512,1024]` and returns `y` with the same dimensions.
  These are magnitude spectrogram estimates; neither input nor output is waveform PCM.
- STFT: FFT 4096, hop 1024, periodic Hann window. 3072 samples of implicit front padding preserve the first
  sample. The model sees the lowest 1024 of 2049 bins. Per-frame mean masks extend above ~11 kHz, preserving
  reconstruction instead of deleting the high band.
- Four estimates become joint squared ratio masks with epsilon 1e-10. Each mask multiplies the original
  complex spectrum, then inverse FFT and periodic-Hann weighted overlap-add return aligned audio.
- Model windows use 32 context frames on both sides of 448 core frames. Every real STFT frame belongs to
  exactly one core; the Hann overlap remains continuous across model-window boundaries.
- Output order: vocals L/R, drums L/R, bass L/R, other L/R. Eight arrays transfer to the owner with no clone.
- A dedicated Worker runs one inference session at a time and disposes tensors and sessions between each
  stem/chunk. iPhone/iPad (including desktop identity), Safari, and browsers without WebGPU select a separate
  `onnxruntime-web/wasm` entry with the 14.24 MB plain runtime. Other GPU-capable browsers use the JSEP entry.
  GPU initialization/inference failure transfers original input ownership to a fresh, single-threaded plain
  WASM Worker. It never retries in the aborted runtime. Worker/module loading errors surface for manual retry.
  The report identifies the selected execution path and observed GPU queue submissions (null if the browser
  prevents observation). Session selection alone does not prove operators executed on GPU; a positive queue
  count establishes some GPU work, not that every operator ran there. GitHub Pages does not need cross-origin
  isolation or SharedArrayBuffer.
- Cancellation terminates the Worker, including active downloads or WASM calls. The owner must ignore stale
  messages after a track change. The Worker closes itself on completion or error.

The first iPhone report showed `previous call to initWasm() failed`, a secondary error that hid the actual
initialization failure. The [upstream Safari/JSEP report](https://github.com/microsoft/onnxruntime/issues/26827)
documents compiler memory pressure with JSEP and successful plain-WASM operation. This supports routing around
JSEP on Apple browsers, but does not prove that was the user's first failure. Failed preparation now offers
Copy details with the first error, runtime/version and stage, including both causes if a GPU retry also fails.
No song name, path or media contents are included. Full-song output is allocated after the first real chunk's
inferences and finite-mask validation, and temporary source decoder references are dropped before worker startup
to reduce initial pressure.

## FP32 computation correction (2026-10-24)

The owner's iPad report for a second supplied song showed `invalid audio` in section 1 of 17, with 206.8125 MiB
of WASM heap. The exact source reproduced this error in the production build on desktop WebKit, both with and
without cross-origin isolation. Instrumented inference found 53,304 nonfinite estimates in the **bass** output.
The first failing operation was the third decoder ConvTranspose (`convolution_2`): its output approached the
FP16 finite limit, 65,504, and contained 101 nonfinite activations. Source PCM and the other three model outputs
were finite. The old error's `other` stage was misleading because validation ran after all four models.

WASM now uses `fp32-compute-v1`: after the original size/SHA checks, a strict adapter derives a graph that
casts the 60 stored FP16 weight tensors to FP32 and keeps activations in FP32 through every operator. The
download, weight bits, licensing, learned values, input gain, stereo channels, 512-frame context and spectral
pipeline are unchanged. Stereo is a learned two-channel input, not an independent batch that can be split.
This avoids half-precision overflow; it does not attenuate the song, clamp estimates, or replace NaNs with zeros.

The adapter verifies the exact pinned graph contract, metadata, types, bindings and operator inventory before
conversion and fails on drift. It uses the protobuf schema shipped inside `onnxruntime-web@1.30.0`, a deliberate
private dependency that must be rechecked on any runtime upgrade. Derived graph bytes are temporary; cached
publisher artifacts still retain their original hashes. Parser code stays in the opt-in workers, outside the
normal app shell and startup precache. The WASM runtime binary and checked 256 MiB reservation cap are unchanged.

Every raw model estimate is now checked immediately, before full-song output allocation. An error names the
actual part and gives the invalid count/index; WebGPU numeric failure triggers the existing fresh WASM worker
recovery. Preparation reports record `computeVersion` and `computePrecision`, and Copy details also carries
`separationFix`, while retaining `startupFix: bounded-wasm-v2` for the separate memory correction.

The model/cache format version deliberately stays stable: previously completed, finite cached stems remain
usable without re-preparation. A failed nonfinite result was never saved. The new computation applies to new
preparation; it does not rewrite existing PCM. Removing saved stems explicitly allows regeneration if wanted.

## Memory, quality and device acceptance

The owner confirmed successful preparation on the physical iPhone after the bounded-memory release, then
reported warbling with All stems at 100% tempo. Following the normal-speed playback correction, the owner
confirmed on 2026-10-23: "Yes, All at 100% sounds clear." The agreed release gate is complete and Beta is removed.
Actual-model recombination of a 30-second excerpt from the
supplied song measures -148 dB residual before caching and -80.8 dB after the PCM16 cache roundtrip. Playback
quality is a separate gate from inference success. The stem transport now directly plays its existing PCM
at 100%/zero pitch, avoiding the tempo engine's unity-rate phase processing and eight-channel CPU cost.
Other rates retain pitch-preserving processing; saved stems require no regeneration. This phone confirmation
covers the supplied song at normal speed, not isolated-stem quality, other songs or other playback rates.

The playback correction was measured in the production player at 48 kHz using actual cached PCM16 stems.
All at 100%, cue jumps, pause/resume and return from 80% match the PCM loaded into the worklet at about
148.8 dB SNR. This comparison isolates playback after resampling; it does not imply lossless original-file
decoding/resampling, perfect isolated-stem quality, or physical iPhone listening acceptance. Real-wrapper
regressions cover both 44.1 and 48 kHz timing and unchanged 80% processing.

The owner's next iPhone report exposed the first plain-WASM failure: `RangeError: Out of memory` during the
first vocal section. The pinned runtime creates a shared WASM memory with a 4 GiB maximum even with one thread.
Our checked Vite adapter changes that maximum and the three JS growth ceilings to **256 MiB**, preserving the
WASM binary and GPU runtime. It verifies the exact 1.30.0 bundle SHA-256
`11e64bd8ffe11bd1a2a2f0d6275fdfbbba7262f0b76b99b53d228a8a22ef3d90`, version and replacement counts, and fails the
build if the worker resolves around it. Installed dependencies are not modified. Copy details identifies
`bounded-wasm-v2` and includes reserved maximum/observed heap without any media data.

WebKit reports [255103](https://bugs.webkit.org/show_bug.cgi?id=255103) and
[250569](https://bugs.webkit.org/show_bug.cgi?id=250569) document failures from large shared-memory maximums.
In a controlled desktop reproduction, rejecting the old worker's 4 GiB reservation produces the same first
vocal-section error reported by the phone. The corrected worker completes with a constructor guard rejecting
reservations above 256 MiB. This supports the fix but is not a measurement from the owner's iPhone.

Only one verified cached model is retained in JS memory at a time. If a cache write fails, that model stays
in memory for this job to avoid repeated network downloads. The report's `downloadMs` includes model reads
and integrity checks on every section; `separationMs` excludes those reads.

Spectral work is bounded to one chunk; input and completed output still grow with song duration. At 4:30,
eight output Float32 channels alone use 381 MB, before source PCM, models and runtime. The 256 MiB WASM cap is
not a whole-app memory cap. The 4:30/100 MB source limits and 500 MiB saved-stem cache limit remain in place.
These safeguards reduce memory pressure but cannot guarantee that every device can prepare or play stems
without interruption. The notice before **Prepare stems** explains that preparation and playback use extra
memory, and that low-memory devices may stop playback or close ClassTempo. It advises preparing before class
and closing unused apps. Do not advertise a universal time or memory guarantee. Never run inference
automatically during playback.

The four spectral tests verify FFT inversion, finite complementary masks, silent/one-sample behavior and
complete stereo reconstruction across both endpoints and a model-chunk seam. The checksum-verified vocals model also
completed an actual installed `onnxruntime-web@1.30.0` WASM run in Node: ~146 ms initialization and 361 ms
inference for one 512-frame stereo input on the development Mac. A complete 12-second stereo synthetic
separation through all four checksum-verified models and the ClassTempo spectral adapter took 3.07 seconds,
with eight finite outputs and a maximum reconstruction error of 3.75e-8 across a chunk boundary.
This is browser-runtime compatibility
evidence, **not an iPhone benchmark or an audio-quality review**.

Broader physical iPhone/iPad preparation speed, memory stability, isolated-stem quality, background
behavior, changed-tempo stem playback and Bluetooth/lock-screen acceptance remain separate checks.
Spleeter is an older model and can leave audible bleed/artifacts. Finite output and perfect recombination
verify the signal pipeline; they do not establish good separation quality.

Above approximately 11 kHz, the selected model has no learned separation bins. The per-frame mean mask
extends the lower-band stem proportions into that high band. This keeps cymbals/sibilance audible and all
four stems complementary, but can distribute high-frequency sound into the wrong stem. It is not a hi-hat
isolation feature. At digital silence, all estimates become equal one-quarter masks through epsilon;
the original complex spectrum is zero, so the inverse remains exactly silent. Extremely quiet content can
approach an even split; the masks do not synthesize new content or amplify the spectrum.

## Integrated desktop verification

For the FP32 correction, full-file numerical regressions using the production adapter, spectral code and
PCM16 codec passed all 68 model runs for the new 171-second song, all 92 for the prior 229-second song, and all
104 for a stereo 270-second boundary fixture derived from the prior source. Every estimate was finite. Peak
bounded WASM heap was **143.5 MiB**, with the unchanged 256 MiB reservation cap. Summed-stem residuals were about
-148 dB before caching and -83.16/-80.28/-80.15 dB respectively after PCM16 storage. These are Mac numerical
measurements, not physical iPad speed or isolated-stem listening acceptance.

On the failing first chunk, all 4,194,304 output values across the four graphs were bit-identical between the
production adapter and a comparison graph that directly stored the same FP16-rounded weights as FP32. This
checks conversion fidelity, not equivalence to the upstream model before its original FP16 weight rounding.

The production browser build also prepared the complete new song in non-isolated desktop WebKit and Chromium
using the actual pinned models. Both saved the stems and passed All-at-100%, mute, pause/resume and Original
switching. Chromium reloaded the complete app offline and reused saved stems in 0.85 seconds without inference
requests. Desktop WebKit's automated offline-navigation attempt returned an internal browser error, so that
attempt does not establish offline app-start acceptance. A fresh WebKit browser launch reused the saved stems
in 0.81 seconds without model requests, then played them with networking disabled. Physical iPad confirmation
remains pending.

The following measurements predate the FP32 correction and preserve the earlier regression baseline:

The bounded plain runtime prepared the owner's supplied 3:49 stereo AAC in 56.9 seconds, using 206.8125 MiB
of WASM heap throughout 23 sections; its saved result reopened offline in 1.38 seconds. A 270.000000-second
version completed 26 sections in 61.0 seconds with the same heap peak and reopened offline in 2.05 seconds.
Both passed source switching, mute, tempo and playback controls with a constructor guard rejecting WASM
maximums above 256 MiB. A 270.000998-second file plays normally but stems preparation rejects it before any
inference requests. Actual desktop WebKit also passed real inference and phone layouts without cross-origin
isolation. These tests use the pinned real models; local fixture serving excludes publisher download latency.
The owner's subsequent preparation and All-at-100% listening confirmations are recorded above.

The production browser build downloaded the four real publisher artifacts and separated a 240-second local
fixture with 24 chunks: 23.41 seconds separation, 26.94 seconds worker total, 32.19 seconds through cached PCM
and playback readiness. The selected WebGPU path recorded 480 GPU submissions. Offline reload of the saved
stems took 1.52 seconds without model requests. Ordinary launch and selecting the Stems pill made no inference
asset requests. Chromium and desktop WebKit also passed 12-second real-audio preparation, controls, cue/tempo
playback and seven responsive layouts; WebKit saved results survive repeated reloads.

Independent live AudioContext tests cover eight-channel stereo isolation, all-muted silence, Talk gain,
pitch at 50/150 percent, position slopes, cue jumps and worklet reuse (22 checks). These are regression
measurements on the development Mac, not physical-phone acceptance or a subjective separation-quality claim.
