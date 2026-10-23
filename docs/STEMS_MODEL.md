# ClassTempo local stems (beta)

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

- Input: 44.1 kHz stereo Float32 PCM, up to four minutes in this beta. Longer songs fail before downloading the model.
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
  stem/chunk. Auto selection tries WebGPU and falls back to one-thread WASM on setup or inference failure.
  The report identifies the selected execution path and observed GPU queue submissions (null if the browser
  prevents observation). Session selection alone does not prove operators executed on GPU; a positive queue
  count establishes some GPU work, not that every operator ran there. GitHub Pages does not need cross-origin
  isolation or SharedArrayBuffer.
- Cancellation terminates the Worker, including active downloads or WASM calls. The owner must ignore stale
  messages after a track change. The Worker closes itself on completion or error.

## Memory, quality and device acceptance

Spectral work is bounded to one chunk; input and completed output still grow with song duration. Four minutes
of eight output Float32 channels alone is 339 MB, before source PCM, models and runtime. The limit is a guard,
not proof that every iPhone can process that length. Preparation can fail due to browser memory pressure;
do not advertise a universal time or memory guarantee. Never run inference automatically during playback.

The four spectral tests verify FFT inversion, finite complementary masks, silent/one-sample behavior and
complete stereo reconstruction across both endpoints and a model-chunk seam. The checksum-verified vocals model also
completed an actual installed `onnxruntime-web@1.30.0` WASM run in Node: ~146 ms initialization and 361 ms
inference for one 512-frame stereo input on the development Mac. A complete 12-second stereo synthetic
separation through all four checksum-verified models and the ClassTempo spectral adapter took 3.07 seconds,
with eight finite outputs and a maximum reconstruction error of 3.75e-8 across a chunk boundary.
This is browser-runtime compatibility
evidence, **not an iPhone benchmark or an audio-quality review**.

Physical iPhone/iPad preparation speed, memory stability, output quality on the user's music, background
behavior, pitch-preserving stem playback and Bluetooth/lock-screen acceptance remain separate checks.
Spleeter is an older model and can leave audible bleed/artifacts. Finite output and perfect recombination
verify the signal pipeline; they do not establish good separation quality.

Above approximately 11 kHz, the selected model has no learned separation bins. The per-frame mean mask
extends the lower-band stem proportions into that high band. This keeps cymbals/sibilance audible and all
four stems complementary, but can distribute high-frequency sound into the wrong stem. It is not a hi-hat
isolation feature. At digital silence, all estimates become equal one-quarter masks through epsilon;
the original complex spectrum is zero, so the inverse remains exactly silent. Extremely quiet content can
approach an even split; the masks do not synthesize new content or amplify the spectrum.

## Integrated desktop verification

The production browser build downloaded the four real publisher artifacts and separated a 240-second local
fixture with 24 chunks: 23.41 seconds separation, 26.94 seconds worker total, 32.19 seconds through cached PCM
and playback readiness. The selected WebGPU path recorded 480 GPU submissions. Offline reload of the saved
stems took 1.52 seconds without model requests. Ordinary launch and selecting the Stems pill made no inference
asset requests. Chromium and desktop WebKit also passed 12-second real-audio preparation, controls, cue/tempo
playback and seven responsive layouts; WebKit saved results survive repeated reloads.

Independent live AudioContext tests cover eight-channel stereo isolation, all-muted silence, Talk gain,
pitch at 50/150 percent, position slopes, cue jumps and worklet reuse (22 checks). These are regression
measurements on the development Mac, not physical-phone acceptance or a subjective separation-quality claim.
