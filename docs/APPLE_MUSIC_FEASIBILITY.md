# Apple Music feasibility — ClassTempo

Status, 2026-10-23: **not enabled or verified**. The owner has enrolled in the Apple Developer Program.
MusicKit media identifier/key and developer token setup remain pending.
ClassTempo currently plays imported local songs and videos. No streaming button or subscription promise is exposed.

## What is established

- Apple documents authorized catalog/library playback in apps and websites through [MusicKit](https://developer.apple.com/musickit/).
- Apple's native MusicKit provides a [playbackRate property](https://developer.apple.com/documentation/musickit/musicplayer/state-swift.class/playbackrate).
- The native iPhone app [Grooves](https://apps.apple.com/us/app/grooves-song-speed-changer/id592398757) advertises Apple Music tempo changes with pitch preserved and section repetition. This is evidence of a native path, not proof of equivalent behavior in Safari or this PWA.
- The current local audio engine receives decoded file samples. Streaming playback must use its authorized provider player; do not assume stream access to decoded samples, waveform/BPM analysis, stems, or provider downloads.

## Prerequisite

Set up the owner's Apple Developer account, enable the appropriate MusicKit identifier/key, and create a developer token according to [Apple's instructions](https://developer.apple.com/documentation/applemusicapi/generating-developer-tokens).
Never commit the signing private key or a user's music token. Keep signing material in a secure service or deployment secret. A developer token's lifecycle and allowed web origin need a deliberate deployment setup; this repository remains a static Pages site today.

## Bounded iPhone spike

Use MusicKit on the Web v3 in an isolated diagnostic screen, with explicit user authorization, once the prerequisite exists. Do not place experimental controls in the teaching player.

1. Sign in, search the catalog and read the user's library/playlist without changing it.
2. Play a full subscribed track from a tap over the instructor's actual Bluetooth/AirPlay speaker connection. Record iOS version, browser versus installed PWA, SDK version, account/subscription status, and connection.
3. Test 100%, 75%, and 110% playback. Confirm actual elapsed source-time versus wall-time and listen for preserved pitch; setting a property alone is not acceptance.
4. Seek to a saved time, repeat a 10-second phrase ten times, and measure boundary delay and cumulative drift. Test a finite repeat count, start delay, pause during the gap, manual seek, and switching tracks.
5. Lock/unlock, use headphone controls, interrupt with a call, leave/return to the app, and disconnect/reconnect the speaker. Confirm state follows actual audible playback.
6. Disable networking. Report exactly what the provider supports; do not label a subscription download as a locally cached ClassTempo file.
7. Sign out and expire/revoke the token. Confirm recoverable errors and that no stale timer starts playback.

Publish only capabilities demonstrated on the physical iPhone. If web playback cannot provide reliable pitch-preserving tempo and phrase control, evaluate a native iOS MusicKit build before promising streaming parity. Keep the local player independent so this experiment cannot regress teaching sessions.

## Classroom use and Spotify

Technical playback and permitted classroom use are separate checks. [Apple's consumer terms](https://www.apple.com/legal/internet-services/itunes/us/terms.html) specify personal, noncommercial use. Confirm a permitted music source/arrangement for the intended commercial classes before positioning the streaming integration for that use.

[Spotify's standard developer policy](https://developer.spotify.com/policy) explicitly excludes products targeted at businesses, including dance studios; its [support guidance](https://support.spotify.com/us/article/spotify-public-commercial-use/) excludes public playback in those settings. Do not advertise Spotify classroom playback under those standard terms. No Spotify integration is shipped.

## Remaining evidence

There is no authenticated MusicKit run, physical-iPhone streaming result, or streaming deployment in this release. The setup and device test remain an external prerequisite; local class tools can ship independently.
