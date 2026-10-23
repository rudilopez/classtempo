# Live classes — release validation, 2026-10-23

The owner approved building and publishing the teacher-first Classes redesign. This supersedes the older
manual-only file-picker behavior. Classes now retain a teaching session in the player.

## Behavior

- Library separates Teach class from explicit Edit/Save. Add full media or a saved named practice, including
  practices from a file that is not currently loaded. Each occurrence has an independent name, note and snapshot.
- Teach, running-order selection and Resume open paused. Full media entries use 100% tempo with no active
  practice or delay; practice entries restore their saved settings without overwriting the source track defaults.
- Next & play advances and starts the next exercise. Again restarts the exercise's prepared range/repeats,
  retaining the current tempo and omitting a new start delay. The running order includes Previous and Exit.
- Auto-next is off by default. When enabled it advances at a full-file end or after the final finite practice pass.
  Endless repetition never advances automatically. The final exercise finishes without wrapping.
- Resume stores the class, occurrence, position, Auto-next and completion state, never playback permission.
  Exit retains the previous place; Finish marks it complete. Missing files stop preparation with an import message.
- Video Stage keeps the running order below the picture. One native video element survives Stage and file changes.
  A browser can refuse video playback; the player keeps the explicit Play path available.

## Validation

- Typecheck, 284 unit tests and production build passed during development; final release checks are rerun before commit.
- Desktop Chromium and WebKit, using real stored WAV and MP4 fixtures: Teach paused, full-song defaults instead
  of an old loop, Next with saved practice, two finite passes, Again, Exit/reload/Resume paused, audio-to-video
  playback, automatic progression, no wrap, endless-repeat behavior and preserved source/class settings.
- Chromium delayed-decode regression: lock-screen Pause prevents later autoplay; Exit cancels a pending track
  and practice commit; resume keeps the previous occurrence. Deleting the actual stored Blob while retaining
  available metadata blocks Teach rather than silently skipping the missing exercise.
- Integrated library/editor and player/Stage layout checked at 360x780, 390x844, 430x932, 844x390,
  768x1024, 1180x820 and 1366x1024. Dialog focus, keyboard dismissal and unchanged native-video identity checked.
- No stems model/runtime changes; prior physical-iPhone stems acceptance remains separate from this release.

Physical iPhone acceptance for class transitions, background Auto-next and lock-screen actions is still pending.
Desktop WebKit does not establish those device results. User media was not added to the repository.
