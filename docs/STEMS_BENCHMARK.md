# Stems feasibility benchmark (historical research only)

The current local stems feature uses a separate Spleeter pipeline; see [STEMS_MODEL.md](STEMS_MODEL.md).
This document and hidden route describe the earlier HTDemucs experiment, not the engine used by Prepare stems.

Open https://rudilopez.github.io/mixdeck/#stems-benchmark on the iPhone or iPad. This is a hidden research page;
normal Dancer/DJ playback does not load its model or runtime. Entering or leaving the page reloads the document
so previous playback worklets do not remain alive during the measurement.

## Device test

1. Use Wi-Fi for the first run. Choose a local audio file at least four minutes long and smaller than 100 MB.
   Audio stays on the device; no song is uploaded. The selected file is decoded locally before the requested
   30-second or four-minute prefix is processed.
2. Leave **Try WebGPU, fall back to WASM** selected and run **First 30 seconds**. The initial download is
   165.6 MB of weights plus about 28.3 MB of runtime before HTTP compression. Keep the page visible.
3. Save the report and listen to the four five-second previews (drums, bass, other, vocals). If the page crashes,
   reopen it and save any interrupted-run diagnostics. Cancel stops the Worker, including an active inference.
4. Run **First 4 minutes** on the same file, then save the second report. A shorter file is reported at its
   actual length and cannot pass the four-minute gate. Repeat on the iPad if available.

The performance gate is approximately two minutes of separation for a real four-minute iPhone clip, with no
crash and acceptable output. Report download, initialization and end-to-end time separately; they matter for
first-use experience even when separation meets the target. This benchmark retains only short previews and
measures full input processing; it does not test full-song stem storage or synchronized stem playback.

## Model provenance and license boundary

- Export: [StemSplitio/htdemucs-onnx model card at pinned revision](https://huggingface.co/StemSplitio/htdemucs-onnx/blob/d54ed9eb60e258ea82131c6ee14578628816456a/README.md).
- Revision: `d54ed9eb60e258ea82131c6ee14578628816456a`.
- File: `htdemucs_fp16weights.onnx`, 165,612,636 bytes.
- SHA-256: `d05c269d0178d2a72ad484b10b11dd370193fc923201c3b27a99f848745db70a`, checked before every run.
- Contract: 44.1 kHz stereo, `mix [1,2,343980]` → `stems [1,4,2,343980]` in drums/bass/other/vocals order.
  Half precision reduces the stored weights; runtime computation remains float32.
- The exporter labels the artifact MIT. **That does not establish production permission for the weights.**
  The upstream author says pretrained weights are not covered by the MIT code license and are provided for
  scientific/research use: [upstream #327](https://github.com/facebookresearch/demucs/issues/327) and
  [HTDemucs v4 clarification #508](https://github.com/facebookresearch/demucs/issues/508).
- This route is a research feasibility experiment. Production stems require clear weight permission or a
  replacement model with suitable provenance, independently of the speed gate. No weights are committed to
  this repository or bundled in the Pages deployment; the browser requests the pinned publisher artifact.

## Runtime and measurements

Pinned dependency: `onnxruntime-web@1.30.0` (MIT), installed for browser inference in a Worker. Use its complete
JSEP runtime and matching WASM asset. The reduced native `/webgpu` + asyncify build cannot execute this export's
DOUBLE-valued ConstantOfShape nodes. Microsoft documents the build distinction in the
[WebGPU migration design](https://github.com/microsoft/onnxruntime/blob/main/docs/design/onnxruntime_web_jsep_to_webgpu_ep_migration.md#7-build-configuration-parity).
Graph optimization inflated initialization memory in the desktop trial; disabled optimization permitted actual
WASM inference. One runtime thread supports GitHub Pages without COOP/COEP response headers.

Fixed 7.8-second chunks have 25% overlap and weighted reconstruction. The Worker checks output shapes and finite
samples, computes RMS for all stems, retains five-second previews, and disposes each input/output tensor. It
records provider selection, observed GPU queue submissions, fallback reasons, model cache state, timings,
model hash and runtime version. A created WebGPU session without observed submissions is labelled unverified.

**Peak memory is not a fabricated number:** browsers do not expose reliable combined page/Worker/WASM/GPU peak
memory. The report explicitly marks total peak unavailable. Optional Worker JS heap samples and an owned-PCM
estimate exclude model/runtime allocations and decoding; they are not a substitute for device crash testing.

## Validation so far

Desktop Chromium processed a synthetic 30-second stereo test file through five chunks with finite outputs
for all four stems. WebGPU separation took **7.09 seconds**, with **19.67 seconds** from start to result and
**595 observed GPU queue submissions**. A WASM fallback run (after a failed WebGPU initialization) took **54.18 seconds** for separation and **68.16 seconds**
total. Disabling graph optimization fixed initialization for both providers. These are desktop execution
measurements; synthetic audio is not a listening-quality test and neither result establishes iPhone acceptance.

The final production build also processed **240 seconds in 43.81 seconds of separation** (53.20 seconds total,
41 chunks, 4,879 observed GPU submissions, model reused from cache), with finite outputs and all four previews
loaded. Cancelling active inference returned in 44 ms; failed and interrupted run diagnostics survived reload.
The model download was from the real pinned publisher URL, verified by hash. See
[desktop report JSON](handoff/stems-desktop-results.json) for the raw timing records.

Real iPhone and iPad HTDemucs 30-second/four-minute results remain pending. This historical route never
enables full-song playback or caching. The current product uses the separate Spleeter feature linked above.
A server fallback, streaming stems and Stems FX remain out of scope.
