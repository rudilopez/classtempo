# Apple Music tempo: web listening trial

Status, 2026-10-28: **investigation and explicit opt-in trial; audio quality is not accepted.** ClassTempo remains a web app for phones. A native app, Xcode setup or separate app installation is not the intended solution.

The earlier Chrome experiment changed playback speed, but the owner heard warbling when slower and a pitch change when faster. Original-speed Apple Music playback was clear. That result rejects the tested Chrome experience; it does not establish the result on physical iPhone Safari, the Home Screen app, or Android Chrome. Normal ClassTempo Apple Music playback stays at 100% until a clean implementation passes listening checks.

## What the web player can control

MusicKit Web v3 exposes `playbackRate`. Apple's reference describes passing the speed to the browser media element, whose supported range can vary. The public API does not expose a choice of music time-stretch algorithm or a pitch-quality setting. See the [MusicKit instance reference](https://js-cdn.music.apple.com/musickit/v3/docs/index.html?path=/story/reference-javascript-musickit-instance--page) and [official SDK source](https://js-cdn.music.apple.com/musickit/v3/musickit.js).

The [HTML Standard](https://html.spec.whatwg.org/multipage/media.html#dom-media-preservespitch) defines `preservesPitch`, which defaults to true. When it is true and playback speed differs from 1, the browser must compensate pitch. This establishes intended behavior, not freedom from audible artifacts. The standard does not let a web app choose a higher-quality time-stretch algorithm.

Browser implementations can differ:

- The inspected [Chromium audio renderer](https://chromium.googlesource.com/chromium/src/+/21778bc49bb739be574234d4023e36eb7ede5bf3/media/filters/audio_renderer_algorithm.cc) selects waveform-similarity overlap-add (WSOLA) for pitch-preserving changed-speed playback, and resampling when pitch preservation is disabled.
- Current upstream [WebKit's Cocoa media session implementation](https://github.com/WebKit/WebKit/blob/main/Source/WebCore/platform/audio/cocoa/MediaSessionManagerCocoa.mm) maps its music/general pitch-correction choices to Apple's Spectral algorithm and its speech choice to TimeDomain. The choice comes through WebKit settings in [HTMLMediaElement](https://github.com/WebKit/WebKit/blob/main/Source/WebCore/html/HTMLMediaElement.cpp), not a public MusicKit option. Apple describes Spectral as its music-oriented quality option in the [AVFoundation algorithm reference](https://developer.apple.com/documentation/avfoundation/avaudiotimepitchalgorithm).

These source observations justify comparing real browsers. They do **not** prove which implementation ships on the owner's installed OS, establish Safari quality, or explain the earlier pitch change by themselves. Do not attribute a failure to a specific algorithm without device evidence.

## Open the trial

After the trial is deployed, open:

[ClassTempo Apple Music tempo trial](https://rudilopez.github.io/classtempo/?tempo-test=1#apple-music)

The `tempo-test=1` query explicitly enables the experiment in the existing player. Ordinary app entry remains at original speed. The trial starts at **100%**, with **70%, 85%, 100%, 115% and 130%** presets. These are test points, not an approved production range.

The trial uses the public MusicKit playback rate. It reapplies the latest requested rate after a current Play/seek operation completes, because provider startup can reset it. It does not patch private SDK fields, change the SDK-owned audio pipeline, extract protected samples, or route streaming audio through ClassTempo's local engine. Native media properties are inspected read-only for diagnostics. Local-file tempo processing remains independent.

The compact trial panel temporarily replaces Back 10s and Talk with rate presets. **Details** opens instructions, a 12-second approximate timing check and **Copy test details**. **End test** pauses and returns to the ordinary controls at 100%, preserving the current position, including a cue prepared before first Play. It is disabled while a song/seek is still loading. Choosing a different song starts paused at 100%.

The diagnostics separate:

| Reading | What it can establish | What it cannot establish |
| --- | --- | --- |
| Requested rate | The selected speed | Whether the provider or browser applied it |
| Reported rate | The rate exposed by the player/media element | Clean audio or preserved audible pitch |
| `preservesPitch` | The browser element's declared pitch-correction state, if observable | An audible-quality pass or which algorithm is running |
| Source time / wall time | Approximate speed over the sampled interval | Pitch, percussion stability, or absence of warbling |

An unavailable media reading means **unknown**, not false or unsupported. Timing can be affected by buffering, coarse provider updates and interruptions. Do not treat a successful rate change, a true pitch flag, or a favorable timing ratio as a substitute for listening.

## Listen on actual phones

Start with the exact Apple Music song and version used in the failed test. Confirm subscriber playback continues beyond a preview. Use the same speaker/headphones and a recognizable passage with sustained vocals and percussion.

1. Play at **100%** and listen to the reference passage.
2. Return to that passage and compare **85% → 100% → 115%**. Voices should retain their pitch; beats should stay steady. Listen for watery or wobbling voices, metallic percussion, crackling and repeated dropouts.
3. If these sound clean, repeat at **70%** and **130%**, returning to 100% between comparisons. If a rate sounds bad, record that rate and return to 100%.
4. Inspect requested/reported rates and source/wall timing as supporting evidence. Record audible quality separately. Try a second song with different instrumentation before making a broader claim.
5. Repeat on **physical iPhone Safari**, the **iPhone Home Screen app**, and **physical Android Chrome**. Record the actual device, OS, browser/version, listening route and rate. Desktop Chrome, desktop Safari, viewport emulation and automated stubs are separate evidence; they do not pass these device checks.

For the Home Screen check, first confirm that the installed app actually shows the opt-in trial controls. A regular installed app opening its normal start URL is not a trial run. Do not change the ordinary app's startup behavior to force the experiment.

## Preserve the teaching controls

At each candidate rate, verify these behaviors in the ordinary player and Stage:

- **Playing cue:** jump to the saved point and keep playing. **Paused cue:** jump to the saved point and remain paused. Check a cue before the stream's first Play as well.
- Pause, choose a rate, and confirm there is no audio until explicit Play. Playback must not restart after a quick Pause, an interrupted seek, or leaving the Apple Music source.
- Seek and Restart preserve their existing play/pause behavior. Check that the selected rate does not unexpectedly reset or change pitch after these actions. After End test, verify Back 10 seconds and Talk in the ordinary controls.
- Open another song paused and confirm its safe initial rate is 100%. Switching to a local file stops streaming and preserves the independent local player behavior.
- Reopen the ordinary URL without `tempo-test=1` and confirm original-speed playback and the normal interface.

A new speed path must retain the state-preserving cue behavior accepted for the existing player. Do not restore the historical always-play cue workaround to make a tempo test seem successful.

## Acceptance and next decision

No device or changed-speed quality pass is recorded for this trial yet. Local transport tests cover opt-in gating, rate errors, pending Play/Pause/seek cancellation, new-song reset and preservation of fresh paused cue offsets when ending the test. A temporary browser fixture verified paused speed selection, 85% after simulated startup reset, the timing readout and paused 100% exit. All seven required viewports fit without document overflow; trial touch controls are at least 44 px and phone cue pads remain 88 px. The fixture contains no streaming audio and was removed after testing.

The release decision needs both transport checks and listening results for the supported phone/browser combinations. Record failures honestly by device and rate; do not silently substitute 100% while displaying a requested different speed.

If a browser cannot produce clean playback through the supported MusicKit controls, keep that browser at original speed and describe the limitation. A native rewrite or protected-audio processing workaround is outside the owner's web-only direction. The next product decision must follow the actual listening results, not the presence of a slider or an upstream algorithm name.
