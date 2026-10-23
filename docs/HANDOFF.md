# Handoff — open work, in priority order

## Stems normal-speed playback correction (2026-10-23)

The owner confirmed the bounded-memory release prepares the supplied song on the physical iPhone, but
reported warbling even with All stems at 100% tempo. This confirms preparation, not listening quality.
Beta remains until normal-speed stem playback sounds clear on that device.

An actual-model 30-second excerpt from the supplied AAC recombines to the original with a -148 dB residual;
the production PCM16 cache roundtrip measures -80.8 dB. The separator and saved PCM therefore do not explain
the All-at-100% distortion in that excerpt. The existing tempo engine phase-processes audio even at unity;
eight channels also require more processing than ordinary stereo. Neither desktop phase measurements nor CPU
timings alone prove the exact audible phone cause.

The stem node now opts into direct, scheduled playback of its existing transferred PCM at 100% tempo and
zero pitch shift. Paused stem nodes also skip unnecessary processing. Other tempos retain the existing
pitch-preserving engine; the ordinary song player is unchanged. A checked adapter verifies the pinned
Signalsmith wrapper and fails the build on source drift or bypass. No extra full-song buffers are allocated,
and saved stems keep their existing identity: users do not need to prepare them again for this playback fix.

The production player at 48 kHz was measured using actual PCM16 cached stems from the supplied-song excerpt.
All-at-100% output now matches the PCM delivered to the worklet at 148.8 dB SNR; pause/resume, cue jumps and
returning from 80% to 100% also match. The previous build measured -1.23 dB SNR in the same captured flow.
Nine tests exercise the real pinned WASM/wrapper at 44.1/48 kHz, including exact scheduled onset, rapid
replacement of pending cues/pauses, end silence, tempo transitions and unchanged non-unity processing.
Chromium and actual desktop WebKit both pass this captured production-player flow. Typecheck, 262 tests and
the production build pass. There are no extra model requests, layout overflows or page errors in the browser checks.
These establish transport correctness; the owner must still confirm clear sound on the iPhone.

## iPhone stems memory cap and 4:30 limit (2026-10-23)

The next physical iPhone report (`plain-wasm-v1`) failed on the first vocal section with
`RangeError: Out of memory`. The plain 1.30.0 runtime still requested a 4 GiB WASM maximum. A checked Vite
adapter now caps that reservation and growth at 256 MiB; it verifies the exact upstream bundle hash and
fails builds if that source or module resolution changes. It does not patch installed dependencies or the
GPU runtime. Models are read and verified one at a time; only failed cache writes retain weights for the job.
Memory failures have actionable wording, and Copy details identifies `bounded-wasm-v2` with the configured
maximum and observed heap. Model identity, separated audio and existing saved stems remain compatible.

The owner supplied the failing 3:49 stereo AAC and approved **4:30 as the stems-only preparation limit**.
Ordinary song/video playback has no duration cap. The source-size guard remains 100 MB. Keep Beta until the
supplied song succeeds on the physical iPhone; desktop checks missed the preceding failure.

The exact song completed local production-browser preparation in 56.9 s, with all 23 sections using at most
206.8125 MiB of WASM heap. Playback, source/mute/tempo controls and offline saved-stem reopening passed;
the saved result reopened in 1.38 s without inference/model requests. A constructor guard rejected any WASM
reservation above 256 MiB throughout the run. Applying a comparable guard to the old deployed worker
reproduced the phone's first-section error. These are controlled desktop measurements, not physical iPhone
measurements. Actual desktop WebKit also passed real inference and phone layout checks without cross-origin
isolation. Typecheck, 253 tests and production build pass.

A 270.000000 s version of the supplied song completed all 26 sections in 61.0 s with the same 206.8125 MiB
heap peak, working controls and a 2.05 s offline saved reopen. A 270.000998 s file still opens and plays
normally, but Prepare rejects it with the 4:30 limit before requesting a worker, runtime or model. Test media
remains outside the repository and is never uploaded.

After deployment, close and reopen the app while online and retry the supplied song. Do not clear website
data: it contains saved media, cues, practices and classes. A successful phone result is still needed before
removing Beta or claiming iPhone memory stability.

## iPhone stems startup correction (2026-10-23)

The owner reported `no available backend found ... previous call to initWasm() failed` on a 3:49 song.
The first release retried WASM inside the same JSEP runtime after GPU failure, hiding the original startup error.
Apple browsers now select a separate plain-WASM runtime directly. Other browsers retain GPU preparation and
transfer the original PCM into a fresh CPU worker if inference initialization fails. Both first and fallback
errors are preserved through Copy details. Output allocation and temporary decoder references are reduced at
startup; model identity, saved stems, audio controls and source playback remain compatible.

Verification: typecheck, 247 tests and production build pass. Actual 12-second preparation passes in desktop
WebKit and Chromium with iPhone/iPad identities, requesting only the plain runtime on Apple paths. Injected GPU
startup failure recovers in a fresh CPU worker; injected CPU failure preserves its first diagnostic and succeeds
on manual retry without reloading. Cancel and new-file replacement suppress stale results. A four-minute local
fixture prepared with plain WASM in 50.7 seconds on the development Mac and reopened offline in 1.35 seconds.

The upstream WebKit/JSEP compilation issue is evidence for the compatibility change, not proof of the exact
phone cause. Physical iPhone preparation still requires the owner to retry the deployed correction. Do not
clear site data as an update workaround; that would remove the user's saved media and settings.

## Local stems beta (2026-10-23)

The owner requested stems. The Cues/Stems panel now prepares local audio with explicitly requested Spleeter
4-stem inference (vocals/drums/bass/other), replacing the unavailable message. It does not use the historical
research-restricted Demucs weights. Model provenance, exact hashes and license notices are in STEMS_MODEL.md.

Prepare downloads about 80 MB of model weights plus runtime only after a tap. Separation runs locally in a
cancellable Worker; the original recording remains available. Ready stems use one 8-channel Signalsmith
transport for shared tempo, cues and practice. Pads mute parts; Acapella/Instrumental/All are shortcuts.
Low/High drums focus frequency ranges, rather than isolating kick/hi-hat. Original returns to the source at the
same position. Pending practice delays/gaps survive source switches; opening new media cancels preparation.

The first beta limits songs to four minutes and 100 MB. Results save as scaled PCM16 in a separate 500 MiB,
content-addressed LRU cache; saving failure leaves session playback available with honest feedback. Source
media/classes are never removed by stems cache eviction. No video decoding or streaming integration is added.
The user has separately enrolled in Apple's Developer Program; MusicKit credentials/testing remain pending.

Verification: typecheck, 236 tests and build pass. Chromium/WebKit each cover actual 12-second preparation,
pad/shortcut changes, tempo, cue playback, original/stem selection, saved reload and seven required layouts.
A measured 8-channel Chromium audio test covers 22 stereo/mix/pitch/transport checks. Cancellation, stale load,
practice gap switching and full/unavailable storage have separate browser cases. WebKit reload testing found
and fixed a Blob-handle defect: recency now lives in a separate IndexedDB usage store.
Final browser review also verifies active finite practice passes survive either source switch, and a failed
replacement file cannot leave the displayed stem mix out of sync with the next prepared song.

The production build fetched all four real pinned models and prepared a 240-second local fixture in 32.2 s
on the development Mac (23.4 s separation, 480 observed GPU submissions). Saved stems loaded offline in 1.5 s.
Normal app launch and selecting the Stems pill made no inference/model requests. These are desktop results.

Physical iPhone/iPad preparation speed, memory stability, listening quality, Bluetooth and lock-screen behavior
remain unverified. The owner's confirmed 1080p video acceptance is unrelated to these new audio stem checks.

## Stage-only large video and Cues/Stems header (2026-10-23)

The owner clarified that the large video layout belongs only in Stage. The regular player returns to the
previous picture/tempo/full cue-pad layout, with a Cues/Stems pill replacing the Cues heading. Stems displays
an unavailable message; switching the pill preserves playback and never loads the experimental engine.

Video Stage's Cues panel is now a compact horizontal row of numbered buttons below the picture, including
empty slots that save the current position. Saved slots launch cues. All eight existing slots and their keys
remain intact. The row scrolls sideways on narrow phones. Tools also opens below the picture, not over it.
The full picture, playback controls and End practice remain reachable. Audio Stage keeps its prior layout.

Verification: typecheck, 206 tests and build pass. Chromium/WebKit cover 112 regular-player layout cases and
147 Stage cases across the seven required phone/tablet sizes. The main video picture matches the pre-update
baseline at all seven sizes. Browser flows cover cue creation while paused/playing, saved-cue launch, cue-row
scrolling and focus, same-element video, named-practice repeat/End, and switching Cues/Stems without changing
playback or downloading models. Physical iPhone acceptance of the new controls remains separate.

## Video picture and compact controls (2026-10-23)

The owner confirmed the supplied 1080p test copy works on the iPhone. This is acceptance of that derivative,
not the original 4K M4V. Neither file belongs in Git.

Video now uses the available height above a compact Play / Cues / Practice / Tools / Stage dock and seek line.
Cues and Tools open over the picture only when requested; the active practice name and End practice remain
visible. Stage uses the same pattern with Exit. Full-picture Fit remains the default, and tray toggles keep
the existing native element playing. Audio keeps its previous layout. Narrow editing trays use two columns
and internal scrolling to preserve Clear/Rename touch targets.

Verification: typecheck, 206 tests and build pass. Main video passed 84 Chromium/WebKit layout cases; Stage
passed 105 across the seven required phone/tablet sizes, including safe-area checks in Chromium. Browser flows
cover playback/seeking, cue creation/editing, keyboard focus, mirror/zoom/tempo, named-practice repetition and
End, same-element Stage transitions and decoder-error recovery. Seven early-load-error layouts retain the
return-to-audio path. At 390×844 with safe areas, the actual portrait picture grew from about 62×110 to 332×590
CSS pixels. Separate audio comparisons show unchanged layout. Physical acceptance of this new layout is still
separate from the owner's confirmed playback of the 1080p test copy.

## Named practices and explicit exit (2026-10-23)

Practice name and saved-practice selection now lead the editor. Save practice and Start practice commit the
visible name/range together with independent tempo, repeat/count, gap, delay and video options. Existing saved
sections and storage keys remain compatible. End practice is available in the main player, editor and Stage:
it cancels timers, pauses at the current position, clears Talk and active delay, and restores full-track Play.
Saved practices remain available and selecting one restores its options.

Verification: 206 tests and typecheck/build pass. Chromium and persistent WebKit cover named preset save,
restore, rename, reload, discard, delete/Undo and modal focus. Dialogs passed 28 phone/tablet/safe-area cases;
main player and Stage passed 56 layout cases. End during audio/video playback, delay, gap and completion,
plus Stage and video Talk, passed 22 real-browser cases while preserving saved snapshots and cancelling timers.
Four additional main/Stage checks cover legacy full-track delays: End remains visible and clears the delay.

The original 31-second M4V was subsequently supplied. The iPhone diagnostics show metadata followed by native
decode error 3 before the first picture (zero dimensions), with the source labeled video/quicktime. The exact
source passes full desktop Chromium/WebKit playback, including forced QuickTime and M4V MIME labels. No MIME
workaround was published without evidence. A local 1080p MP4 derivative passed full desktop playback, Stage and
library reopening; the owner subsequently confirmed it works on the iPhone (see the update above).
Neither source nor derivative belongs in Git.

## Cue, Practice and video follow-up (2026-10-23)

The owner reports the original 31-second video still fails. The subsequently supplied file and iPhone native
decode diagnostics are covered above. Do not mark that original phone failure fixed.
The loading path now avoids a forced 0.001-second seek and uses metadata preloading. Native errors offer a
user-initiated paused retry and a bounded diagnostic copy with no media bytes, filename or file path.

Empty cue pads now set on one tap; Edit protects existing cues, with Undo available after creation. Practice
supports start/end cue selection and commits the visible range directly from Start practice or Save & close.
A new range defaults to Repeat until stopped. The main player identifies Repeat/Section, range and pass status.
Launching a cue within the range retains practice; leaving the range explains its switch to full track.

Verification: 200 tests plus typecheck/build pass. Fractional cue/track endpoints retain exact precision, so
End of track cannot round past the actual duration and block Start/Save. Chromium and persistent WebKit verify cue-selected ranges,
direct Start/Save, finite repeats, invalid bounds, Undo, Full track and focus restoration. Practice passed 28
phone/tablet/safe-area cases; main-player audio/video/cue editing passed 21; video recovery passed 28, with four
additional early-load-failure layouts. Actual desktop audio/native-video runs cover zero-gap, gap, file-end,
infinite/manual-stop and inside/outside-cue behavior. These results do not replace the original-file/iPhone test.

## Current direction — ClassTempo (2026-10-22)

The owner approved the classroom-focused redesign and publication. The working name is **ClassTempo**.
The single player has one Open action for either songs or videos; no mode choice or DJ processors remain in the
product flow. The larger ClassTempo header uses the palm-tree logo for its final o, alongside Open, Library and
Keep awake. Demo has been removed.

Library now has two jobs: Media lists every saved song/video with a type badge; Classes holds named, ordered
teaching plans. Classes opens to cards, then an explicit detail view with All classes navigation. Search filters
saved media only, with counts, clearing and no-match feedback; an empty library leads with Add media. Adding
files saves the selection and automatically opens the first paused. Failed storage still permits direct opening
with unsaved feedback. Save current preserves the loaded track and practice state.

Native video decode failures now latch playback off until a new load, cancel pending practice, and replace
Mirror/Fit with a readable error. The transport no longer shows Pause after a fatal failure. The original user
M4V's iPhone decoding failure remains a physical-device acceptance item; see the exact-file investigation above.

The classroom release adds local IndexedDB media storage and recents, ordered class sets with independent
exercise settings, named A/B sections, finite/continuous repetition, pauses between attempts, an adjustable
seconds countdown, per-track tempo, video mirror/zoom, Talk, and explicit cue editing with undo. Settings
backup includes class sets, cues and practice preferences; audio/video files must be retained separately.
Stage keeps the same video element and offers playback, restart section, tempo, Talk and set cues.

Streaming is **not enabled**. The owner confirmed Apple Developer/MusicKit is not set up. See
[APPLE_MUSIC_FEASIBILITY.md](APPLE_MUSIC_FEASIBILITY.md) for prerequisites and the actual-iPhone experiment.
Musical beat-count count-in, watch integration and video frame stepping are later features; this release uses
a visible seconds countdown. Stems remain a separate research benchmark with the existing device/license gates.

Real-iPhone acceptance remains open: the original 31-second 4K video, lock-screen scrubber, delayed/repeated
audio through screen lock, video delay after its first audible play, speaker interruptions, and offline saved
media. A first video play starts immediately to establish audible playback permission; later starts use its
saved delay. Do not infer these physical-device results from desktop WebKit/Chromium checks.

Usability update checks: typecheck, all 180 tests and the production build pass. Chromium and persistent
WebKit verify import failures still open paused without retrying the failed save, saving the current file
preserves playback/tempo, picker cancellation preserves the track, and recency failures do not block opening.
Production Chromium verifies mixed-file batch import, Media search and type badges, Classes overview/detail,
independent exercise tempo and offline saved-class playback. Media, Classes and class detail pass 42 responsive
cases across both browsers and the seven required sizes, with 44 px controls and internal dialog scrolling.
These are desktop checks, not iPhone acceptance.

Original classroom release checks: typecheck, all 171 tests and production build passed. Chromium covers the seven required sizes,
cue undo, delay cancellation, exact section endpoints, class persistence, independent exercise tempos, backup
restore/relink and offline saved-audio playback. Desktop WebKit passes the integrated classroom flow and both
31-second 4K fixtures; the audio/video fixture completes all 744 frames at 75% tempo. Video never enters the
audio decode/analysis path. Three-pass audio and video repeats at file boundaries also pass.

Use a persistent profile for desktop WebKit storage QA: the bundled browser's ephemeral profile rejects even
raw Blob/File IndexedDB writes outside the app. Persistent profiles pass. Real storage errors now explicitly
abort transactions and have bounded deadlines, so a failed save cannot leave Library stuck on Working.
These checks validate the release candidate; verify the GitHub Pages workflow and live bundle separately.

Earlier handoffs and completed work below are preserved as history and are superseded by this direction.

Original handoff baseline (2026-10-22): branch `dancer-v2`, working tree passes `npm run typecheck`, `npm test`
(123 tests) and `npm run build`. Production (`main`, GitHub Pages) still runs the previous release; nothing below
is deployed yet. The owner tests on an iPhone (Home Screen app) — anything touching the lock screen, audio
session or video must be confirmed there by the owner.

## Codex follow-through (2026-10-22)

The release candidate resolves all 11 original review findings, plus DJ master gain leaking into Dancer audio
and keyboard focus escaping Stage. Phone layouts also preserve 72×72 cue pads with safe areas. Browser checks
cover audio/video cues and restoration, 75% video rate with pitch preservation, uninterrupted video through
Stage open/close, DJ Demo/SYNC/LOOP/crossfader, fullscreen interruption recovery, inactive native media guards,
hidden-canvas inactivity and offline playback. The lock-screen scrubber still needs confirmation on a real iPhone.

The hidden research benchmark is at `#stems-benchmark`; see [STEMS_BENCHMARK.md](STEMS_BENCHMARK.md) for exact model
provenance, a real desktop execution result, device steps and licensing restrictions. The original ~80 MB/MIT
weight assumption was not confirmed: this four-stem export is 166 MB, and upstream restricts pretrained weights
to research despite the exporter's MIT label. Full section 2b requires both device acceptance and suitable weight
permission. A server fallback remains unapproved.

The original instructions/reports below are preserved as handoff history; completed findings are tracked in
[handoff/dancer-v2-reports.md](handoff/dancer-v2-reports.md).

## Compact design and 4K video follow-up (2026-10-22)

The next release adds a single-row Dancer header (brand, mode pills, Demo, Load, Screen on), a media-card song title
with the supplied logo as the O in Now Playing, clearer panel/control contrast, an inline tempo percentage and
72 px Stage cue rows. Screen on explains that it prevents dimming/auto-lock while MixDeck is visible.

The owner reported a blank/frozen 31-second, 2160×3840 H.264/24 fps video, 77.1 MB. The app previously started a
second whole-file audio decode for video BPM/waveform analysis and mounted the picture only after metadata.
Video now mounts during loading, retains the element when dimensions arrive late, and never starts audio analysis.
The frame reports loading or decode errors rather than silently staying blank. Desktop Chromium and WebKit
checks pass for a matching 31-second, 2160×3840 H.264/24 fps, 78.2 MB synthetic clip, with AAC audio and without
audio; no audio decode calls were observed. Same-element Stage transitions and 75% key-locked tempo pass.
This does not establish that the owner's exact video works on the physical iPhone; that retest remains open.

## Demo removal (2026-10-22)

Removed the synthetic Demo buttons from Dancer and both DJ decks, along with the unused track generator.
Use Load or drag and drop to open audio/video files. Earlier Demo references below describe historical checks.

## 1. Finish and ship "Dancer v2" (mostly built — verify, fix, deploy)

Owner's requests (verbatim): "on lock screen I can not move the sound bar. Can que show on lock? … what does the
sun icon next to load? Make the modes pills that get pressed to change. Also make dancer the default. … can we add
if video loaded it either fills the wave area or we have a full screen that shows play, restart and que only. also
are queue saved for songs or it starts over each time we load?" (que/queue = cue)

What was built (see [handoff/dancer-v2-reports.md](handoff/dancer-v2-reports.md) for the agents' full reports):
- **App shell**: no start screen; the app opens in Dancer mode; header segmented pills `[Dancer | DJ]`; both modes
  stay mounted (inactive one `hidden`) so songs stay loaded; switching pauses the mode being left;
  `Engine.create()` no longer awaits `resume()`, `Engine.unlock()` resumes inside the first gesture.
- **Lock screen**: root-cause analysis of the non-draggable scrubber is in the comment block at the top of
  `apps/web/src/platform/keepAlive.ts` with the fix applied; the Media Session second line shows the cue section
  ("Chorus · next: Bridge", `platform/cueLabel.ts`).
- **Video**: `VideoDeck` (native `<video>`, `preservesPitch` key lock — videos are NOT decoded into memory, phone
  videos can be hundreds of MB); video shows in the waveform area with a slim cue strip; **Stage** view = full
  screen with only video (or cue name + time), Play/Pause, Restart, launch-only cue pads, ✕.
- **"Screen on"** labelled wake-lock toggle (was the unlabeled sun icon); "Cues restored" message when a song with
  saved cues loads.

To do:
1. Work through the **11 review findings** at the end of [handoff/dancer-v2-reports.md](handoff/dancer-v2-reports.md).
   The fix pass was interrupted, so some may already be fixed — check each against the code.
2. Manually verify in a browser at 390×844, 844×390 and 1180×820: Demo audio flow; load a video (any MP4); tempo
   75 % → `video.playbackRate` 0.75 with `preservesPitch`; set/launch cues on audio and video; Stage view
   open/close (the same `<video>` element moves back to the waveform area); pills switch modes; DJ mode still
   works (both Demo tracks, Play, SYNC, LOOP, crossfader); reload → cues restored.
3. Update README / ARCHITECTURE / BUILD_PLAN to describe the above (the docs pass never ran). Mark the lock-screen
   scrubbing fix "needs confirmation on a real iPhone".
4. Merge to `main` to deploy; tell the owner what to test on the iPhone: lock-screen scrubbing, cue line on the
   lock screen, video + Stage view, pills.

## 2. Stems for Dancer mode (new scope, no Stems FX)

The owner wants VirtualDJ-style stem pads (reference: Vocal, Instru, Bass, Kick, HiHat, Acapella, Instrumental),
**without Stems FX**. Stems were previously "Deliberately out of scope" in docs/VISION_AND_PARITY.md — move them
into scope (streaming services stay out) and add a phase to docs/BUILD_PLAN.md.

### 2a. Feasibility spike first (≈ 2 days) — gate for the rest
- Run HTDemucs (4 stems: vocals, drums, bass, other; MIT-licensed — verify the licence of the exact weights you
  use) with `onnxruntime-web` on the WebGPU execution provider (WASM fallback) inside a Worker, on a 30 s and a
  4 min clip. Candidate ONNX exports exist on Hugging Face (search "htdemucs onnx"; e.g. chunked WebGPU exports);
  prefer fp16 weights to keep the download ≈ 80 MB.
- Ship it as a hidden route/page in the deployed app so the owner can run it on the iPhone and iPad; report
  separation time, peak memory, and whether WebGPU was used. iOS 26 Safari has WebGPU; older iOS only WASM.
- Decide with the owner: on-device (acceptable if a 4-min song splits in ≲ 2 min on the iPhone) vs. a server
  fallback (faster, but uploads songs and costs money — owner has not approved that).

### 2b. Build (≈ 3–4 weeks if the spike passes)
- **Model download on demand**: first tap on "Stems" asks "Download the stem engine (~N MB)? Best on Wi-Fi." —
  cache it (Cache Storage/OPFS), `requestPersistentStorage()`, works offline afterwards; re-download if evicted.
- **Separation** in a Worker: chunked inference with overlap-add, progress ("Splitting stems… 40 %"), cancel
  when another song loads; the song keeps playing normally while it splits.
- **Cache stems per song** in OPFS (16-bit PCM or compressed), keyed like cues (name|duration) + model version;
  LRU cap (e.g. 1.5 GB) and a "manage stems storage" list with delete. Second load of a song = instant stems.
- **Playback**: extend `StretchDeck` to play the 4 stereo stems through ONE Signalsmith node (8 channels) so they
  stay sample-locked with tempo/key lock and cues; `ChannelSplitterNode` → per-stem `GainNode` (10 ms ramps) →
  stereo mix. Check how `signalsmith-stretch` accepts >2 channels (its README: channel options).
- **Kick / HiHat** without a second model: split the drums stem at playback time with Linkwitz-Riley crossovers
  (two cascaded Butterworth biquads) at ~150 Hz and ~6 kHz into low / mid / high bands that sum back flat.
  Pads: **Drums** mutes all drums; **Kick** toggles the low band; **HiHat** toggles the high band.
- **Pads** (Dancer mode, a "Stems" panel; phone-portrait layout must still fit — a collapsible row or a tab next
  to the cue grid): Vocal, Instru (= "other"), Bass, Drums, Kick, HiHat + shortcuts Acapella (vocals only),
  Instrumental (all but vocals), All. Tap = toggle, lit = audible. Optional: "No vocals" in Stage view.
- **Scope limits for v1**: audio files only (videos use the native element path — stems for video would need the
  audio decoded; skip or allow only for files ≤ 150 MB later); DJ-mode stems later; no Stems FX.
- Tests: crossover sums to unity (offline render), stem gain routing, cache key/LRU logic, chunk overlap-add math.
- Acceptance: on the owner's iPhone a 4-min song splits without crashing, stems play in sync at 50–150 % tempo,
  pads respond instantly, the second load is instant, offline works after the model download.

## 3. Smaller follow-ups
- In-app hint "Press Play before locking the screen" (iOS won't start audio from the lock screen).
- Recent-songs library so songs don't have to be re-picked each session (Phase 2: File System Access / OPFS copies).
- DJ mode lock-screen controls (currently Dancer only).
