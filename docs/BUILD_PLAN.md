# ClassTempo delivery plan

The current product is a single-track dance teaching app. The former multi-deck/djay-parity roadmap is retired;
legacy work remains in Git history and the historical handoff. The working name is ClassTempo. Repository/package
identifiers and the `/mixdeck/` deployment URL remain stable.

## Current classroom release

Implemented in the release candidate; production status must be established from the deployment workflow and
live site, separately from this checklist:

- One audio/video player with a single Open action and automatic media-type detection. No DJ mode, mixer surface or synthetic Demo.
- Classroom engine creation without DJ decks or their worklet processors.
- Compact phone header, media-panel title, inline speed percentage, supplied Now Playing logo and distinct controls.
- Key-preserving audio speed at 50–150%; native-video speed/pitch preservation where supported.
- Native video loading without a duplicate audio decode, explicit readiness/errors and same-element Stage transitions.
- The regular player retains full controls and a Cues/Stems header; Stems has opt-in local audio separation.
  Only video Stage maximizes the picture above compact playback/seeking controls. Cues opens a numbered row
  below the picture for setting/selecting cues; Tools also opens below it. End practice remains reachable.
- Keep awake, Stage playback controls, video mirror/zoom and Talk (audio attenuates; native video pauses).
- Media lists all saved songs/videos with type badges, recents, saved-media search, import-and-open, local-copy removal and honest save failures.
- Classes separates Edit class preparation from Teach class playback; backup utilities stay collapsed.
- Live class strip and running order, Next & play, Again, optional Auto-next (off by default) and paused resume.
  Exercise names/notes, repeated media and independent named-practice snapshots survive explicit saves/backups.
  Full-file exercises use fresh 100%/no-practice defaults. Actual-file checks run before entering a class.
- Named cue-based A–B practices with independent saved tempo/repeat/delay/video options, direct Start/Save actions,
  active-name/pass progress, and End practice in the player/editor/Stage to restore normal Play without losing presets.
- One-tap empty cues with Undo; existing-cue changes require Edit. Saved cues preserve the playing/paused
  state in the player and Stage. Stable saved-cue keys preserve existing work.
- JSON export/restore for class sets, cue data and practice settings, excluding media files.
- Existing lock-screen/headphone controls and interruption recovery retained.
- Visual user guide at `guide.html`, linked from Library, with searchable topics and enlarged screenshots.
  Guide text is cached with the app; screenshots load on demand and remain available offline after viewing.

The first native-video Play is immediate to establish sound permission; start delay applies on later starts.
A musical count-in is not part of this delivery. New features must not imply that timer-based repetition or
lock-screen behavior has been accepted on a physical iPhone until it actually has.

## Release verification

Required automated checks are `npm run typecheck`, `npm test` and `npm run build`. Then verify the workflows below
in Chromium and WebKit as appropriate, recording the build tested:

1. Import an audio file, adjust tempo, edit/undo cues, reload and restore settings.
2. Save and reopen media from IndexedDB. Confirm an unavailable/quota-failed store produces an explicit message
   and never claims that the file is saved offline.
3. Create/reorder a class set, add full songs/videos and named practices from media that is not currently loaded,
   and save exercise names/notes. Repeat one file with different snapshots. Confirm full-file entries do not inherit
   old repeats/delays, and class edits never rewrite track defaults. Teach a class, use Next & play and Again,
   select an entry paused, and restore a session paused. Check manual/default and opted-in Auto-next at full-track
   end and final finite practice pass; endless repeats must stay put. Cancel pending transitions with Pause, Exit,
   another entry or a new file. Missing actual Blobs, decode errors and blocked video autoplay must stop honestly.
4. Set A/B, play once, repeat a finite number of passes and use a gap/start delay. Cancel each waiting state via
   Pause, seek, cue launch or new load; stale timers must not start another track.
5. Export metadata, restore into fresh storage and reconnect missing original files. Existing data survives merge;
   imported practice settings are normalized before playback. No backup claims to contain audio/video.
6. Load video, including a 31-second 2160×3840 H.264/24 fps fixture. Verify picture/readiness, speed, mirror/zoom,
   Talk and same-element Stage transitions. Loading a video must not call the audio analysis/decode path.
7. Exercise keyboard focus, Escape, dialogs, safe areas and touch targets. Main phone portrait must not require
   page scrolling; editors/library scroll internally. Check 360×780, 390×844, 430×932, 844×390, 768×1024,
   1180×820 and 1366×1024, including relevant video/edit/Stage states.
8. Build/serve production, visit online to populate the app cache, then open a saved local file offline. Repeat
   with missing media to verify the app requests reimport instead of promising availability.

After successful branch checks, merge to `main`, verify GitHub Actions deployment, then inspect the live release.
A passing local build, pushed branch or PR is not evidence that the phone received the new app.

## Physical-device acceptance still required

The owner must confirm the following in the installed Home Screen app on the actual iPhone, then cover iPad and
Android before claiming those devices accepted:

- The reported 31-second 4K portrait H.264 video (77.1 MB), including playback through its end and Stage transitions.
- Lock-screen seeking during playback, Pause → Play, title/cue metadata and headphone Previous/Next.
- Audio and native-video start delays, section endpoints, repeated playback and gaps while visible and locked.
- Call/voice-assistant interruptions, returning from the background and Tap to resume audio when required.
- Bluetooth class-speaker playback and recovery if the route changes.
- Keep awake granted/refused/released states, safe areas and offline access after a prior online launch.
- Reopen a prepared class and recover its selected exercise settings without unexpected playback. Verify Next &
  play, Again, manual versus opted-in automatic progression, finite practice completion and mixed audio/video classes.

A desktop browser pass is useful regression evidence but cannot replace these checks. Keep the original video
and existing cue data available when testing. Paused lock-screen scrubbing remains a known WebKit limitation.
The owner confirmed the supplied 1080p derivative plays on the iPhone on 2026-10-23; original 4K acceptance remains open.

## Next gate: instructor music access

The intended users primarily obtain music from Apple Music or Spotify. On 2026-10-28 the owner clarified that
the integration must use the familiar ClassTempo player, or an identical player, and approved **same player
first at normal speed; investigate clean tempo next**. A separate connection-test interface is not the product
goal. Apple Music browsing belongs in a picker; song selection closes it and returns to paused Now Playing.
Shared presentation does not require routing protected streams through the local audio engine.
Saved Apple Music cues must behave like local cues in the regular player and Stage: jump and continue when
playing; jump and stay paused when paused. Verify this before the first Play as well as after playback, and
verify that Pause and source changes cancel pending cue work.

Apple Developer membership is active, the MusicKit media identifier/key are created, and signing credentials
are stored in GitHub Actions repository secrets. The earlier connection screen established production Chrome
authorization, catalog/library browsing, paused selection, Play/Pause, seeking and teardown. The owner confirmed
clear audio at 100%, and playback beyond the preview range was observed. Slower playback warbled and faster
playback changed pitch. Original-speed streaming shipped first. The owner then requested the slider and
presets in the ordinary player. After their restoration, the owner confirmed all tempos sounded great on Mac
on 2026-10-28. Playback info retains read-only diagnostics. Local files retain their independent engine, named
practices, class plans and stems. Physical iPhone/iPad/Android listening and uninterrupted full-track completion
remain unverified. Follow
[APPLE_MUSIC_SETUP.md](APPLE_MUSIC_SETUP.md) and [APPLE_MUSIC_FEASIBILITY.md](APPLE_MUSIC_FEASIBILITY.md).

Verify source switching, direct file Open, the Apple Music picker, shared Stage, cues and asynchronous seek
cancellation in the new interface, then verify uninterrupted original-speed playback, lock-screen behavior and
phone output on the actual target platform. The owner clarified that ClassTempo must remain web-based across
phones; native app work is outside the intended solution. The visible
[web tempo listening controls](APPLE_MUSIC_TEMPO_TRIAL.md) compare supported browser playback paths without
a special URL. Mac listening acceptance does not establish phone quality; timing and listening checks remain
required on the target devices. Streaming phrase-control support is not implemented. Do not equate MusicKit playback support with access
to raw audio or parity with local-file processing. Spotify is not a promised integration. Platform terms and
permitted classroom music use are independent of whether a technical integration plays a song.

## Later classroom improvements

Prioritize these from observed teaching friction rather than restoring the old DJ backlog:

- Musical count-in with manually aligned first beat and clear tempo interpretation.
- Finer section/cue nudging and editing feedback.
- A simple remote/watch path for repeating the current section; keep song advancement explicit.
- Video frame stepping if mirror/zoom and repeat do not meet choreography review needs.
- Storage usage/management and stronger media identity/relinking if library size or restore behavior requires it.

Do not promise cloud accounts, synchronization, external music integrations or automatic speaker routing as
already implemented. Preserve the local workflow while those decisions remain open.

## Local stems release (2026-10-23)

The owner requested working stems. The Cues/Stems panel now supports explicitly prepared local songs with
four Spleeter stems: vocals, drums, bass and other instruments. Acapella/Instrumental/All shortcuts and
low/high drum frequency focus require no FX controls. Original recording and stem playback share the same
transport, cue and practice controls. Video retains native playback and never enters separation.

The historical HTDemucs research model is not used in the feature. Spleeter's authors explicitly license
pretrained models under MIT; the pinned ONNX conversion, checksums and notices are documented in
[STEMS_MODEL.md](STEMS_MODEL.md). Prepare downloads about 80 MB of models plus runtime only on explicit request.
A cancellable Worker performs chunked inference; full aligned PCM is saved atomically in a separate,
content-addressed 500 MiB LRU cache. A new source cancels work; failures leave the original available.

Preparation is capped at **4:30/100 MB** because completed PCM memory still grows with duration. This limit
does not apply to ordinary song/video playback. The owner requested leaving beta after the supplied song works
on the iPhone. That gate is complete: preparation succeeds, and the owner confirmed clear All-at-100% playback
after the normal-speed correction on 2026-10-23. The plain runtime now reserves at most 256 MiB
instead of 4 GiB, with a checked adapter for the exact pinned runtime and one cached model in JS memory at a time.
Beta is removed. Broader iPhone/iPad memory stability, isolated-stem and changed-tempo listening quality,
Bluetooth and lock-screen playback remain separate checks. The original roughly
two-minute target for separating a four-minute iPhone song remains the goal, not a measured guarantee.
No automatic model download, song upload or server fallback is enabled.

Before preparation, an inline memory notice explains that preparing and playing stems use extra memory and
low-memory devices may stop playback or close ClassTempo. It advises preparing before class and closing unused
apps. The **256 MiB WASM reservation**, **4:30/100 MB source limits** and **500 MiB cache limit** remain in place.
The WASM cap does not cover total app memory; these safeguards cannot guarantee that the browser never closes the app.

### Numerical preparation correction (2026-10-24)

The owner's iPad failed on the first section of a second supplied song. The exact file reproduced the failure
in desktop WebKit without cross-origin isolation: bass-model FP16 activations overflowed, although the old
late validation incorrectly named the final `other` stage. The WASM path now computes in FP32 using unchanged
verified FP16 weights, with immediate per-model finite checks and the same 256 MiB reservation cap. GPU numeric
failures also retry in a fresh corrected CPU worker. Existing finite saved stems and the accepted unity-tempo
playback path remain unchanged. Full-file and 4:30 numerical regressions are recorded in
[STEMS_MODEL.md](STEMS_MODEL.md). Physical iPad preparation/listening acceptance for this correction is pending;
the earlier iPhone confirmation covers its original song, not this newly supplied file.
