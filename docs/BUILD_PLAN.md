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
- Keep awake, Stage playback controls, video mirror/zoom and Talk (audio attenuates; native video pauses).
- Media lists all saved songs/videos with type badges, recents, saved-media search, import-and-open, local-copy removal and honest save failures.
- Classes opens to named cards, then an ordered exercise detail view; backup utilities stay collapsed.
- Named ordered class sets, repeated titles, manual advancement and independent practice settings per exercise.
- Named A–B practice sections, play once/stop, finite or unlimited repeats, gaps and seconds-based start delay.
- Cue edit lock and Undo; stable saved-cue keys preserve existing users' work.
- JSON export/restore for class sets, cue data and practice settings, excluding media files.
- Existing lock-screen/headphone controls and interruption recovery retained.

The first native-video Play is immediate to establish sound permission; start delay applies on later starts.
A musical count-in is not part of this delivery. New features must not imply that timer-based repetition or
lock-screen behavior has been accepted on a physical iPhone until it actually has.

## Release verification

Required automated checks are `npm run typecheck`, `npm test` and `npm run build`. Then verify the workflows below
in Chromium and WebKit as appropriate, recording the build tested:

1. Import an audio file, adjust tempo, edit/undo cues, reload and restore settings.
2. Save and reopen media from IndexedDB. Confirm an unavailable/quota-failed store produces an explicit message
   and never claims that the file is saved offline.
3. Create/reorder a class set. Add the same song twice with different practice settings, load each manually and
   verify it remains paused until Play. No class song should start automatically.
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
- Reopen a prepared class and recover its selected exercise settings without unexpected playback.

A desktop browser pass is useful regression evidence but cannot replace these checks. Keep the original video
and existing cue data available when testing. Paused lock-screen scrubbing remains a known WebKit limitation.

## Next gate: instructor music access

The intended users primarily obtain music from Apple Music or Spotify. The current file player therefore does
not yet satisfy that source workflow. Apple Music is a feasibility project, not an enabled feature. The owner
currently has no Apple Developer account/credentials; authenticated testing remains blocked until those are
available. Follow [APPLE_MUSIC_FEASIBILITY.md](APPLE_MUSIC_FEASIBILITY.md).

Once credentials and a suitable test account are available, prove playback, pitch-preserving speed, seeking,
sections, lock-screen behavior and phone output on the actual target platform. Decide from that evidence whether
the PWA is sufficient or a native implementation is needed. Do not equate MusicKit playback support with access
to raw audio or parity with local-file processing. Spotify is not a promised integration. Platform terms and
permitted classroom music use are independent of whether a technical integration plays a song.

## Later classroom improvements

Prioritize these from observed teaching friction rather than restoring the old DJ backlog:

- Musical count-in with manually aligned first beat and clear tempo interpretation.
- Finer section/cue nudging, editing feedback and optional per-exercise notes.
- A simple remote/watch path for repeating the current section; keep song advancement explicit.
- Video frame stepping if mirror/zoom and repeat do not meet choreography review needs.
- Storage usage/management and stronger media identity/relinking if library size or restore behavior requires it.

Do not promise cloud accounts, synchronization, external music integrations or automatic speaker routing as
already implemented. Preserve the local workflow while those decisions remain open.

## Deferred stems research

The hidden HTDemucs benchmark remains available but is lower priority than classroom playback and music access.
It downloads a 166 MB candidate model on demand and records provider/timing information. The exact pretrained
weights are research-restricted despite the exporter's MIT label. See [STEMS_BENCHMARK.md](STEMS_BENCHMARK.md).

Full stems require both suitable production weight permission and an owner-approved phone result: a four-minute
song separated in roughly two minutes or less without crashing. Actual provider use and memory visibility must
be reported honestly. A server fallback would upload songs and incur cost; it remains unapproved.

If those gates pass, revisit Vocal, Instru (other), Bass and Drums plus filtered Kick/HiHat bands and Acapella /
Instrumental / All shortcuts. Audio files first, no Stems FX. No automatic model download or full stems promise
belongs in the classroom release before those gates are satisfied.
