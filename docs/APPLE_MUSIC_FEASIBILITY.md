# Apple Music feasibility — ClassTempo

Status, 2026-10-28: **original-speed Chrome playback verified; changed-speed listening failed; physical-iPhone acceptance outstanding**.
The signed-in Developer website confirmed active membership. The MusicKit-only Media ID
`media.io.github.rudilopez.classtempo` and an associated Media Services key were created. All three signing
credentials are stored as GitHub Actions repository secrets. The configured Pages deployment succeeded;
Apple's catalog API accepted the developer token. Production Chrome subscriber authorization, read-only
catalog/library browsing, paused selection, Play/Pause, seeking and return-to-local teardown were verified. The owner confirmed clear
audio at 100%, with playback observed beyond the preview range. Slower playback warbled and faster playback
changed pitch. Apple Music is therefore original-speed only. Uninterrupted full-track completion and
physical-iPhone acceptance remain unverified. Detailed evidence is recorded below.
ClassTempo's teaching player continues to use imported local songs and videos.

## What is established

- Apple documents authorized catalog/library playback in apps and websites through [MusicKit](https://developer.apple.com/musickit/).
- Apple's native MusicKit provides a [playbackRate property](https://developer.apple.com/documentation/musickit/musicplayer/state-swift.class/playbackrate).
- MusicKit Web v3 also documents writable `playbackRate`, forwarded to the browser media element, and
  `seekToTime(seconds)`. This establishes an API surface, not preserved pitch or reliable iPhone repetition.
  See the [web instance reference](https://js-cdn.music.apple.com/musickit/v3/docs/index.html?path=/story/reference-javascript-musickit-instance--page).
- The native iPhone app [Grooves](https://apps.apple.com/us/app/grooves-song-speed-changer/id592398757) advertises Apple Music tempo changes with pitch preserved and section repetition. This is evidence of a native path, not proof of equivalent behavior in Safari or this PWA.
- The current local audio engine receives decoded file samples. Streaming playback must use its authorized provider player; do not assume stream access to decoded samples, waveform/BPM analysis, stems, or provider downloads.

## Account and credentials

The Apple account, MusicKit identifier/key and repository secrets are configured as of 2026-10-28.
The deployment signer creates the developer token according to [Apple's instructions](https://developer.apple.com/documentation/applemusicapi/generating-developer-tokens).
Never commit the signing private key or a user's music token. The build signer uses repository secrets,
30-day ES256 developer tokens restricted to `https://rudilopez.github.io`, and a weekly Pages refresh. Public
configuration bypasses the service worker cache. See [APPLE_MUSIC_SETUP.md](APPLE_MUSIC_SETUP.md).

## Prepared connection screen

`#apple-music` loads in a fresh document so the local engine and provider player cannot overlap. A configured
build exposes **Library → Apple Music · Connection test**. Without credentials, that entry is absent and the
direct route explains the missing setup. Apple's SDK loads only inside this route after valid config arrives.
Connect invokes `authorize()` directly in a tap; cancellation is not treated as authorization. Catalog search,
library songs, playlists and playlist tracks are read-only and limited visibly to their first 25 items. Selecting
a song queues it paused; Play is a second explicit gesture. No local file identity, practice or class record is
created for the stream. Disconnect clears visible account lists; stale requests cannot restore them.

Play/Pause, Restart, seeking and Back 10 seconds use MusicKit directly. Initialization, song selection and
Play set the SDK rate to 1. The changed-speed controls and timing panel were removed after the listening
failure below; the UI directs tempo changes to local audio files. The implementation uses supported SDK
controls, without patching a private player or extracting protected streaming samples. Phrase repetition,
native speaker routing and integration into local class sets are not implemented in this spike.
Expired config stops the test and requires reloading fresh configuration. Raw SDK failures and tokens are not
copied into UI diagnostics. A cancelled/stuck account attempt can be abandoned by reloading the connection.

## Bounded iPhone spike

Use the original-speed MusicKit screen with explicit user authorization after verifying the configured deployment. Do not place experimental controls in the teaching player.

1. Sign in, search the catalog and read the user's library/playlist without changing it.
2. Play a full subscribed track from a tap over the instructor's actual Bluetooth/AirPlay speaker connection. Record iOS version, browser versus installed PWA, SDK version, account/subscription status, and connection.
3. Confirm original-speed clarity throughout the track, including after Pause, Resume and Restart.
4. Seek beyond the preview range, use Back 10 seconds and switch tracks. Confirm a selected song remains paused until Play and returning to the local player stops the stream.
5. Lock/unlock, use headphone controls, interrupt with a call, leave/return to the app, and disconnect/reconnect the speaker. Confirm state follows actual audible playback.
6. Disable networking. Report exactly what the provider supports; do not label a subscription download as a locally cached ClassTempo file.
7. Sign out and expire/revoke the token. Confirm recoverable errors and that no stale timer starts playback.

Publish only capabilities demonstrated on the physical iPhone. Streaming tempo and phrase repetition require
a separate supported implementation and new timing plus listening tests before their controls can return.
If web playback cannot provide reliable pitch-preserving tempo and phrase control, evaluate a native iOS
MusicKit build before promising streaming parity. Keep the local player independent so this experiment cannot
regress teaching sessions.

## Classroom use and Spotify

Technical playback and permitted classroom use are separate checks. [Apple's consumer terms](https://www.apple.com/legal/internet-services/itunes/us/terms.html) specify personal, noncommercial use. Confirm a permitted music source/arrangement for the intended commercial classes before positioning the streaming integration for that use.

[Spotify's standard developer policy](https://developer.spotify.com/policy) explicitly excludes products targeted at businesses, including dance studios; its [support guidance](https://support.spotify.com/us/article/spotify-public-commercial-use/) excludes public playback in those settings. Do not advertise Spotify classroom playback under those standard terms. No Spotify integration is shipped.

## Verified evidence and remaining checks

Activation evidence on 2026-10-28:

- [Configured Pages deployment](https://github.com/rudilopez/classtempo/actions/runs/40712530896) succeeded.
- The public configuration returned HTTP 200 with a 30-day token restricted to the production origin.
- Apple's catalog search returned HTTP 200 and a song using that developer token, without a user token.
- Production Chrome: Library entry visible, SDK initialized, listener authorization completed and the
  connected interface appeared.
- Typecheck, all 349 tests and build passed.

Bounded production Chrome playback check on 2026-10-28:

- My songs, Playlists and the selected playlist each returned 25 items; catalog search also worked. These
  were read-only first-page checks, not a complete library audit.
- “Qué Fue Lo Que Me Hiciste” by Dalvin La Melodia queued paused at 0:00 with a displayed duration of 3:49.
  Explicit Play advanced to 0:47, and the owner confirmed clear audible playback at 100%.
- Pause held at 0:47 across several seconds. Seeking to 1:55 kept playback paused; explicit Play resumed
  there. Playback subsequently reached the track's end across the rate experiments. This establishes access
  beyond the preview range and an end transition, not uninterrupted completion of the full track.
- The removed diagnostic reported these timing samples. SDK position reporting is coarse; these are bounded
  observations, not precise rate measurements or proof of pitch preservation:

  | Requested rate | Source seconds | Wall seconds |
  | --- | ---: | ---: |
  | 100% | 11.0 | 10.2 |
  | 75% | 8.0 | 10.2 |
  | 110% | 11.0 | 10.1 |

- **Changed-speed listening failed.** The owner reported: “Audio warbles on slower and pitch changes when
  faster.” Timing response does not override that result. The original-speed setting was restored and playback
  left paused; original-speed enforcement replaces the experimental controls in the app.
- While the subscribed track was playing at 100%, choosing **Local player** stopped streaming and opened the
  empty, paused local player. The new page had no media elements. Reopening Apple Music through Library
  restored the authorized interface without another sign-in, with an empty, paused queue. These are Chrome
  teardown and authorization-restoration checks, not a physical-iPhone result.

Uninterrupted full-track completion, phone speaker/lock-screen behavior and the remaining device checks still
need verification. This Chrome result is not physical-iPhone acceptance, and streaming tempo quality has failed
the current listening gate.
Streaming phrase repetition and integration into local classes are not implemented. Local class tools remain
independent.

Validation of the original-speed update: typecheck, all 351 tests and build passed. Local checks of the real UI
with a MusicKit stub confirmed that a seeded 0.75 rate resets to 1, selection stays paused, and seeking, Back
10 seconds, Restart and Play/Pause work. Layout checks found no overflow and all buttons at least 44 pixels
high at 360×780, 390×844, 430×932, 844×390, 768×1024, 1180×820 and 1366×1024. These are local mock UI checks,
not real streaming-audio or physical-device acceptance.
