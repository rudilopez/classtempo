# ClassTempo product scope

## Purpose

ClassTempo is the working name for a phone-first dance teaching player. Its core job is to let an instructor
find the correct music, start at the correct phrase, teach at an appropriate speed and repeat an exercise without
repeatedly returning to the phone. One track plays at a time. The earlier djay-parity/mixing plan is retired.
The historical filename of this document is retained so existing links still work.

The product is an installable web app for iPhone/iPad and Android, with desktop browsers useful for preparation.
Local media and settings remain on the device. There is no account, cloud upload or server audio processing in
the current release. The source repository and live `/mixdeck/` URL retain their original names.

## Current experience

| Instructor need | Current implementation |
|---|---|
| Open the next piece of music | Open accepts either type; Library Add saves and opens the selection |
| Prepare before class | Saved local library, recents and named ordered class sets |
| Teach one exercise deliberately | Manual entry selection; no automatic next-song playback |
| Reuse one song at different difficulty levels | Repeated class entries with independent practice snapshots |
| Slow down without changing the song's pitch | Signalsmith audio stretching; native video pitch preservation where supported |
| Return to a phrase | Eight named launch cues, retained across loads |
| Repeat a defined phrase | Named start/end sections, repeat counts, optional reset gaps |
| Get into position | Adjustable start delay in seconds; first native-video Play starts immediately for sound permission |
| Prevent accidental preparation changes | Cue editing is explicit, with recent Undo |
| Speak to the class | Talk lowers audio to 20% of normal; native video pauses instead |
| Review choreography | Video mirror and zoom, full-screen-style Stage controls |
| Keep the phone usable nearby | Keep awake where granted; compact controls and safe-area layouts |
| Hear individual musical parts | Local Spleeter stems, part mutes, Acapella/Instrumental shortcuts |
| Recover prepared work | Settings export/restore; media originals kept separately |

Media contains all saved songs and videos, with explicit type labels and a local search. Classes contains ordered
lesson lists built from that media. File selection opens media paused, and cancellation preserves the current
track. Stage uses the same media element and transport.
The supplied palm logo appears in Now Playing and the larger ClassTempo wordmark. Demo and DJ controls are removed.

## The important unresolved gap: music sources

The intended instructors primarily use Apple Music or Spotify, while the shipped player currently accepts
ordinary audio/video files. That source mismatch is more important than adding mixing effects or AI features.
Subscription downloads cannot be treated as importable unprotected files.

Apple Music integration is under feasibility review and is **not configured or supported by this release**.
The owner has enrolled in the Apple Developer Program; authenticated testing awaits MusicKit identifier/key setup.
Follow [the feasibility plan](APPLE_MUSIC_FEASIBILITY.md) before choosing a web or native implementation. Do not
assume that streaming playback exposes raw samples or supports every local-file feature. Spotify support is not
promised. Technical playback permission and the rights/service terms for a dance class are separate questions.

## Design and success criteria

The instructor's next action should be apparent: Play, repeat the current section, change speed or open the next
exercise. Phone space is scarce, so the main view stays compact while library/preparation editors scroll within
their own dialogs. Keep controls distinct and readable; reducing touch targets is not a substitute for hierarchy.

Success is observed when an instructor can reopen a prepared class, find the desired phrase in a small number of
taps and teach repeated attempts without walking back to the phone each time. Measure that workflow on the actual
phone and speaker. Automatic music analysis is assistance, not authoritative dance phrasing or a guaranteed downbeat.

## Constraints and honest limits

- Playback starts from a user gesture. Calls, other apps and browser policies can interrupt audio or require a
  fresh tap. Lock-screen behavior and background practice timers need physical-device acceptance.
- Saved media can work offline only while both app assets and the imported files remain stored. Browser eviction,
  clearing site data and separate Safari/Home Screen storage can remove or separate that work. Export settings
  and keep media originals; a JSON backup does not include the songs/videos.
- Large decoded audio consumes phone memory. Native video avoids an extra audio decode; it is not a guarantee
  that every codec/profile/resolution is playable on every device.
- Bluetooth adds output delay. The app does not control the operating system's speaker route, public playback
  permission or all external remote-button mappings.
- Class snapshots save per-exercise practice configuration. Cue pads remain shared per file, and class entries
  without snapshots use the file's saved practice settings.

## Deferred and excluded work

Musical count-in, finer cue/section nudging, exercise notes and a remote/watch workflow can follow verified class
use. Local stems uses licensed Spleeter weights. The owner confirmed preparation of the supplied song and
clear All-at-100% playback on the iPhone on 2026-10-23, completing its Beta exit gate. Other songs/devices,
isolated-stem quality and changed-tempo listening remain separate checks. No Stems FX, video separation or
server separation fallback is enabled; see [the build plan](BUILD_PLAN.md).

Multi-deck mixing, crossfaders, EQ/FX racks, sync, automix, controller mappings, sampler banks and djay feature
parity are outside the current product scope. Accounts, cloud sync, social features and new native wrappers are
not commitments. A native implementation may be considered only when music-source/device feasibility supplies
an actual reason to need it.
