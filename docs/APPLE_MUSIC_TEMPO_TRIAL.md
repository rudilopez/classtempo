# Apple Music tempo: playback and device acceptance

Status, 2026-10-28: **Mac tempo listening accepted; iPhone 75% listening failed with warbling. Other iPhone rates, iPad/Android listening and uninterrupted full-track completion remain unverified.** ClassTempo remains a web app for phones. A native app, Xcode setup or separate app installation is not the intended solution.

The earlier Chrome experiment changed playback speed, but the owner heard warbling when slower and a pitch change when faster. Original-speed Apple Music playback was clear. After the slider and presets returned, the owner reported, “The slider and presets are back and all tempos sound great,” and identified the tested device as Mac. This accepts the latest listening experience on that Mac; the exact rates, browser version and output route were not specified. It does not establish the result on physical iPhone Safari, the Home Screen app, iPad or Android Chrome. A subsequent physical-iPhone check failed at 75% as detailed below. Each Apple Music song opens paused at 100%. The slider and presets remain visible, with read-only diagnostics under Playback info.

## What the web player can control

MusicKit Web v3 exposes `playbackRate`. Apple's reference describes passing the speed to the browser media element, whose supported range can vary. The public API does not expose a choice of music time-stretch algorithm or a pitch-quality setting. See the [MusicKit instance reference](https://js-cdn.music.apple.com/musickit/v3/docs/index.html?path=/story/reference-javascript-musickit-instance--page) and [official SDK source](https://js-cdn.music.apple.com/musickit/v3/musickit.js).

It does expose **stream bitrate selection**, which is a separate control: [`MusicKit.PlaybackBitrate.HIGH` targets 256 kbps and `STANDARD` targets 64 kbps](https://js-cdn.music.apple.com/musickit/v3/docs/index.html?path=/story/reference-javascript-musickit--page#playbackbitrate). The [`bitrate` configuration/instance property](https://js-cdn.music.apple.com/musickit/v3/docs/index.html?path=/story/reference-javascript-musickit-instance--page#bitrate) affects the next item loaded, not the stream already playing. Apple explicitly describes it as a target, not a measurement of delivered bitrate. A higher source bitrate does not select a different pitch-correction algorithm.

The [HTML Standard](https://html.spec.whatwg.org/multipage/media.html#dom-media-preservespitch) defines `preservesPitch`, which defaults to true. When it is true and playback speed differs from 1, the browser must compensate pitch. This establishes intended behavior, not freedom from audible artifacts. The standard does not let a web app choose a higher-quality time-stretch algorithm.

Browser implementations can differ:

- The inspected [Chromium audio renderer](https://chromium.googlesource.com/chromium/src/+/21778bc49bb739be574234d4023e36eb7ede5bf3/media/filters/audio_renderer_algorithm.cc) selects waveform-similarity overlap-add (WSOLA) for pitch-preserving changed-speed playback, and resampling when pitch preservation is disabled.
- Current upstream [WebKit's Cocoa media session implementation](https://github.com/WebKit/WebKit/blob/main/Source/WebCore/platform/audio/cocoa/MediaSessionManagerCocoa.mm) maps its music/general pitch-correction choices to Apple's Spectral algorithm and its speech choice to TimeDomain. The choice comes through WebKit settings in [HTMLMediaElement](https://github.com/WebKit/WebKit/blob/main/Source/WebCore/html/HTMLMediaElement.cpp), not a public MusicKit option. Apple describes Spectral as its music-oriented quality option in the [AVFoundation algorithm reference](https://developer.apple.com/documentation/avfoundation/avaudiotimepitchalgorithm).

These source observations justify comparing real browsers. They do **not** prove which implementation ships on the owner's installed OS, establish Safari quality, or explain the earlier pitch change by themselves. Do not attribute a failure to a specific algorithm without device evidence.

## Use the tempo controls

Open ClassTempo normally, then choose Library → Apple Music:

[ClassTempo Apple Music player](https://rudilopez.github.io/classtempo/#apple-music)

The player always shows the familiar **50–150% slider**, **−1% / +1%** nudges and **50%, 75%, 90%, 100%, 110%** presets. The earlier `tempo-test=1` link is no longer required. Controls begin at **100%** for each new song. The Mac listening pass does not establish every rate on every device.

The player uses the public MusicKit playback rate. It reapplies the latest requested rate after a current Play/seek operation completes, because provider startup can reset it. It does not patch private SDK fields, change the SDK-owned audio pipeline, extract protected samples, or route streaming audio through ClassTempo's local engine. Native media properties are inspected read-only for diagnostics. Local-file tempo processing remains independent.

Back 10s and Talk remain available. **Playback info** opens read-only diagnostics, a 12-second approximate timing check and **Copy playback details**. Tap the **100%** preset to restore original speed without changing the current playing or paused state, or losing a cue prepared before first Play. There is no End test action that hides the controls. Choosing a different song starts paused at 100%.

The diagnostics separate:

| Reading | What it can establish | What it cannot establish |
| --- | --- | --- |
| Requested rate | The selected speed | Whether the provider or browser applied it |
| Reported rate | The rate exposed by the player/media element | Clean audio or preserved audible pitch |
| `preservesPitch` | The browser element's declared pitch-correction state, if observable | An audible-quality pass or which algorithm is running |
| Source time / wall time | Approximate speed over the sampled interval | Pitch, percussion stability, or absence of warbling |
| Target bitrate | The stream quality requested from MusicKit | The actual delivered codec/bitrate or clean stretching |
| Buffered ranges / seconds ahead | Media the browser currently reports buffered near the playhead | A permanent download, offline availability or pitch quality |
| Local AudioContext state | Whether the independent local engine was created and its reported state | Safari's internal stream buffer size or the cause of warbling |

An unavailable media reading means **unknown**, not false or unsupported. Timing can be affected by buffering, coarse provider updates and interruptions. Do not treat a successful rate change, a true pitch flag, or a favorable timing ratio as a substitute for listening.

## Listen on actual phones

Start with the exact Apple Music song and version used in the failed test. Confirm subscriber playback continues beyond a preview. Use the same speaker/headphones and a recognizable passage with sustained vocals and percussion.

1. Play at **100%** and listen to the reference passage.
2. Return to that passage and compare the **90% → 100% → 110%** presets. Voices should retain their pitch; beats should stay steady. Listen for watery or wobbling voices, metallic percussion, crackling and repeated dropouts.
3. If these sound clean, try the other presets and slider positions, returning to 100% between comparisons. To compare with the prior trial, use the slider at 85% and 115%. If a rate sounds bad, record that rate and return to 100%.
4. Inspect requested/reported rates and source/wall timing as supporting evidence. Record audible quality separately. Try a second song with different instrumentation before making a broader claim.
5. Repeat on **physical iPhone Safari**, the **iPhone Home Screen app**, and **physical Android Chrome**. Record the actual device, OS, browser/version, listening route and rate. Desktop Chrome, desktop Safari, viewport emulation and automated stubs are separate evidence; they do not pass these device checks.

For the Home Screen check, confirm that the installed app has refreshed to show the slider and presets. A regular launch should show them without a special URL; no music should start automatically.

## Preserve the teaching controls

At each candidate rate, verify these behaviors in the ordinary player and Stage:

- **Playing cue:** jump to the saved point and keep playing. **Paused cue:** jump to the saved point and remain paused. Check a cue before the stream's first Play as well.
- Pause, choose a rate, and confirm there is no audio until explicit Play. Playback must not restart after a quick Pause, an interrupted seek, or leaving the Apple Music source.
- Seek, Restart, Back 10 seconds and Talk preserve their existing play/pause behavior. Check that the selected rate does not unexpectedly reset or change pitch after these actions.
- Open another song paused and confirm its safe initial rate is 100%. Switching to a local file stops streaming and preserves the independent local player behavior.
- Reopen the ordinary URL without `tempo-test=1` and confirm the slider/presets are visible, with the newly opened song paused at 100%.
- Use the 100% preset while playing and while paused; it must restore speed without changing playback state or the prepared cue position.

A new speed path must retain the state-preserving cue behavior accepted for the existing player. Do not restore the historical always-play cue workaround to make a tempo test seem successful.

## Physical-iPhone failure at 75% — 2026-10-28

After Mac acceptance, the owner reported slow-tempo warbling on the iPhone. The copied playback diagnostic reports:

- Browser: iPhone OS `18_7`, Safari `Version/27.0.1`, `AppleWebKit/605.1.15`.
- Requested rate, MusicKit-reported rate and native audio rate: all `0.75`.
- Playback active, audio not paused or muted, volume `1`, `readyState: 4`.
- `preservesPitch: true`; no timing sample was supplied.

The 75% iPhone listening check **failed**. These readings rule out a mismatched rate or disabled pitch flag at capture time; they do not establish artifact-free stretching, uninterrupted buffering or the installed pitch algorithm. The 250 ms application poll reads state and does not repeatedly write the rate. MusicKit offers stream bitrate selection, but no public pitch-algorithm or time-stretch-quality selector. Do not claim a new audio fix from a CSS repair or from these correct diagnostic values.

The accompanying screenshot also shows the seek line and Cues header overlapping neighboring controls in Safari's shorter usable viewport. That layout repair is separate from this audio-quality failure. Mac acceptance remains valid for the reported Mac test; it does not override the iPhone result.

The overlap was reproduced at 402×714. Fixed row minima allowed the title/seek content to overflow, while a shrinking Cues region pushed its header upward. The CSS repair uses intrinsic control rows and compact short-viewport spacing. The seven standard sizes plus 360×640, 390×664 and 402×690/714/734 passed panel-containment and overlap checks in Chrome, with controls at least 44 px and full cue pads at least 72 px. Desktop Safari responsive views at 402×714 and 360×640 were also visually checked. This is browser layout evidence, not physical-iPhone acceptance or an audio fix.

## Next candidate: higher-quality stream and buffered replay

The next revision requests **HIGH / 256 kbps at configuration, before any queue is loaded**, through the public MusicKit API. This is a candidate to improve the source presented to Safari, not a confirmed warbling fix. In the official SDK snapshot inspected on 2026-10-28, `BitrateCalculator` defaults to `STANDARD` and automatically recalculates only when `navigator.connection.downlink` exists. ClassTempo previously supplied no bitrate. That creates a plausible client-dependent source-quality difference; it does not prove that the failed iPhone stream was actually 64 kbps. The inspected SDK SHA-256 is `21908b72bdcdeea3ec91fa40b105d0b9a2ba07c2a3fe32ea77edcd26e735012c`; the hosted SDK can change independently of ClassTempo.

The owner's suggestion to wait for more of the song is testable as **buffered playback**, not as an app-managed download. The current public MusicKit reference provides a `bufferedProgressDidChange` event but no documented full-song download or prefetch operation. Read-only [`HTMLMediaElement.buffered`](https://html.spec.whatwg.org/multipage/media.html#dom-media-buffered) reports ranges currently available. [`readyState: 4`](https://html.spec.whatwg.org/multipage/media.html#dom-media-readystate) means the browser estimates it has enough data to continue; it does not require the full track to be buffered. Buffers may plateau or be evicted. Waiting also does not change the browser's pitch algorithm.

The candidate also records the independent local AudioContext's state without changing its lifecycle. A fresh page loaded directly at `#apple-music` does not create the local engine; entering Apple Music after visiting the normal local player retains that engine. Compare these routes as a separate variable. Current [WebKit shared-buffer selection](https://github.com/WebKit/WebKit/blob/main/Source/WebCore/platform/audio/cocoa/MediaSessionManagerCocoa.mm#L164) considers WebAudio sessions even when their samples are separate from native media; [historical iPhone measurements](https://bugs.webkit.org/show_bug.cgi?id=231110#c1) confirm that a separate AudioContext can change the shared hardware buffer. This justifies the comparison, not a claim that it causes this warbling. A suspended context would not, by itself, prove that WebKit released any shared buffer preference, so this revision does not suspend it or claim such an effect.

For the next physical-iPhone check, keep the same song, output route and passage:

1. Load the [direct Apple Music route](https://rudilopez.github.io/classtempo/#apple-music) and fully reload the page before visiting the local player. Confirm Playback info reports that the local engine was not created. Select the song again so the next-item bitrate preference takes effect, and confirm a 256 kbps target. Listen to the passage at 100%, then 75%, and copy details if it warbles.
2. Pause and inspect the buffer ahead. Allow up to 45 seconds for at least 20 source-seconds ahead, then explicitly press Play at 75%. If the buffer stops growing or its reading is unavailable, record that instead of waiting indefinitely.
3. Seek back within a range that is still reported buffered and replay the same passage at 75%. Compare the sound with step 1, recording any waiting/stalled events separately from continuous watery or wobbling sound.
4. Separately, visit the normal local player, return through Library → Apple Music, and repeat the same passage at 75%. Copy details to compare the reported local AudioContext state. Do not change bitrate, output route or passage during this comparison.
5. Record **clear / improved / unchanged**, the rate, target bitrate, buffered ranges, local context state and device/output route. A listening pass on this phone is required before calling the candidate a fix. Restore 100% with the existing preset when finished.

If the same passage still warbles with ample data buffered and no playback stalls, that weighs against network starvation as the main cause; it does not identify a specific Safari algorithm. Do not add a significant-tempo-change download gate without evidence that waiting improves the sound. Keep the web player and requested rates intact; no protected samples, native rewrite or local-file substitution are part of this candidate.

## Acceptance and next decision

On 2026-10-28 the owner confirmed that the slider and presets were back and all tempos sounded great, then identified the device as Mac. The test-only UI wording was removed; Playback info retains diagnostics. The subsequent iPhone 75% check failed; other iPhone rates, iPad/Android listening and uninterrupted full-track completion remain unverified. The prior hidden-link trial's local tests covered gating, rate errors, pending Play/Pause/seek cancellation, new-song reset and fresh paused cue offsets. Its removed browser fixture verified paused selection, 85% after simulated startup reset, timing readout and paused exit; seven layouts fit with at least 44 px controls and 88 px phone cue pads. Those are prior-interface UI/transport results; the owner's later listening report is the separate Mac audio-quality evidence.

The visible-control revision was checked through the ordinary route with no query parameter. A removed simulated-transport fixture verified slider/preset selection, 75% surviving playback startup, 100% reset while continuing playback, and paused Stage nudges reflected back in the main player. All seven required viewports fit; slider/buttons remain at least 44 px high and full cue pads at least 72 px. The smallest portrait and phone-landscape views were visually inspected for overlap. These are UI/transport results, not streaming listening acceptance.

Extending acceptance beyond the tested Mac needs both transport checks and listening results for the target phone/tablet and browser combinations. Record failures honestly by device and rate; do not silently substitute 100% while displaying a requested different speed.

The owner requires clean slowdown of Apple Music on the phone; substituting local files does not satisfy that goal. Preserve the requested controls; never silently clamp a chosen rate to 100% or describe returning to original speed as an audio fix. A native rewrite or protected-audio processing workaround is outside the owner's web-only direction. The iPhone failure remains unresolved until the next candidate passes listening on the physical phone; the Mac pass remains a separate baseline.
