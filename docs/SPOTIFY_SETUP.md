# Spotify setup and verification

Status, October 28, 2026: the ClassTempo Spotify application is registered in Development mode, its exact
production redirect and SDK/API selections are verified, and its public client ID is configured in GitHub
Actions. The configured deployment succeeded, the owner manually approved ClassTempo’s OAuth consent, and the
callback and private-library reads succeeded. After PR #41 corrected idle pause/error-handler behavior,
ClassTempo played a complete real Spotify track at 100%, and the owner confirmed clear audio on Mac. Paused
selection, playing/paused cues, Stage and owned-playlist browsing were verified in that browser. A subsequent
Spotify → Apple Music → Spotify roundtrip failed to restart playback after constructing a second SDK player;
a retained-player lifecycle candidate is implemented but not yet deployed or retested. Physical-phone acceptance
remains pending. YouTube is deferred. App registration and the owner’s acceptance of
Spotify’s registration agreement do not establish Spotify approval of ClassTempo’s use case.

## Product limits

Library → Spotify explains original-speed-only playback, Premium and internet requirements, unavailable
Practice/Stems/class plans/offline playback, and Spotify’s personal/noncommercial restriction. It offers Apple
Music (with a playlist-transfer explanation), Open a file, Files & classes, or Continue at 100% when configured.
Unconfigured builds keep Continue disabled with an explicit setup message. The notice does not override provider
terms. Spotify’s standard developer policy excludes business-targeted uses including dance studios; confirm an
eligible use/agreement before enabling this integration for that purpose.

Development access can read playlist contents only where the signed-in user owns or collaborates on the
playlist. Followed Spotify/editorial playlists may be unavailable. The player explains this restriction on a
denied playlist request and offers another playlist, Search or Saved songs.

## Configuration and evidence checklist

The following records the verified setup separately from the remaining acceptance checks.

| Item | Status and evidence |
| --- | --- |
| Developer application | Registered as ClassTempo; Basic Information shows Development mode. |
| Intended-use description | Truthfully discloses the local-file, Apple Music and teaching app, with Spotify restricted to private, original-speed personal testing. Registration is not provider use-case approval. |
| Production redirect | Verified exactly as `https://rudilopez.github.io/classtempo/`. |
| Products | Web API and Web Playback SDK selected and verified. |
| Registration agreement | Accepted by the owner; the agent did not accept on the owner’s behalf. |
| Public client ID | Stored as GitHub Actions repository variable `SPOTIFY_CLIENT_ID`; a client secret was neither viewed nor used. |
| Deployment | [Actions run 40779762009](https://github.com/rudilopez/classtempo/actions/runs/40779762009) succeeded on `b5c69a60e1669c0ba155da42acd5671d7ad2f450` after PR #41. Live `#spotify` enables Continue at 100%. |
| Automated checks | Typecheck, 552 tests and production build passed for the retained-player candidate, including inactive OS-handler guards, disabled native Media Session ownership, paused cues, non-reentrant SDK errors and late REST cancellation. Live source-roundtrip verification follows deployment. |
| Premium membership | The signed-in owner’s Spotify Account Overview confirms Premium Family. |
| Development users | User Management lists 0/5 explicit test users. The owner’s authorized Web API reads work without an explicit listed entry; this does not establish access for any other user. |
| Real account authorization | Verified: the owner manually approved ClassTempo’s OAuth consent, the callback succeeded, and the authorized UI shows Disconnect. No client secret was accessed. |
| Catalog and private-library reads | Verified: Search returned the requested “Que Fue Lo Que Me Hiciste” by Dalvin La Melodia; Saved songs returned 20 real saved tracks. Metadata access is separate from protected audio playback. |
| Protected player startup | A fresh reload/reconnect after PR #41 reached a usable player. Earlier fresh-document diagnostics after PR #40 recorded `sdk_loaded` at 13 ms, `token_provided` at 232 ms, `connect_resolved` with `true` at 440 ms and `ready` at 552 ms. The cause of the original initial/same-page Retry 20-second timeouts remains unconfirmed. |
| Paused song selection and cue | Verified after PR #41: a real song opened paused without `playback_error`; cue 1 at zero before first Play stayed paused and error-free. While playing, cue 1 sought to zero and kept playing; after Pause, cue 1 stayed at zero with Play shown. The test cue was cleared, leaving all eight slots empty. |
| Idle-pause/error-loop correction | PR #41 corrected pausing an inactive SDK player and repeated pause calls from SDK error handlers. The earlier pre-Play `playback_error` feedback loop did not recur in the fresh selection/cue test. |
| Real protected playback | Verified at 100% in ClassTempo on Mac before the source-lifecycle candidate: explicit Play ran the real “Que Fue Lo Que Me Hiciste” track with a 3:49.4 duration through natural completion. |
| Listening acceptance | The owner answered “Yes, clear audio” for the Mac test at 100% before the source-lifecycle candidate. This establishes that listening result only, not physical-iPhone or other-device audio acceptance. |
| Main player and Stage | Verified in the Mac browser, including a 390×664 phone-sized viewport: playback continued; Stage showed the cover and eight-button cue bar below it. Tools offered only Restart and Talk at fixed 100%. Leaving Stage preserved playback. This is responsive-layout evidence, not a physical-phone test. |
| Natural full-track completion | Verified before the source-lifecycle candidate: the continuous run was observed at 3:41.4, then naturally returned to zero with Play shown at the 3:49.4 end. No next track started. |
| Owned playlists | Verified before the source-lifecycle candidate: the provider playlist list returned 20 items; an owned playlist opened two track rows without errors while the selected song continued playing. |
| Source roundtrip | Failed after PR #41: returning from Apple Music created a second native SDK player, which reached ready at 895 ms, but the subsequent REST Play failed with the sanitized generic error. The HTTP status and cause are unconfirmed. The retained-player candidate below still needs deployment and real roundtrip verification. |
| First-party comparison | Spotify’s own web player played the same song with a 3:49 duration, progressed from 18 to 37 seconds and showed “This web browser” as its current device. It was paused and closed. This comparison does not establish ClassTempo playback or listening acceptance. |
| Physical phones | Pending; iPhone/Android listening, interruptions and background behavior remain separate acceptance checks. |

Do not mark pending rows complete from a successful app registration, deployment or consent screen alone.

## Source lifecycle candidate

This candidate is implemented on `codex/spotify-verified`; it is not yet deployed or accepted in a real source
roundtrip. The Mac 100% audio, cue, Stage, playlist and full-track observations above belong to the earlier
PR #41 baseline. Candidate checks and live retest results must be recorded separately.

The router retains one Spotify React component after its first visit and passes an `active` prop. Normal source
changes keep the native SDK player, selected track and list state. Deactivation invalidates pending actions,
aborts browsing, prepares the current paused offset, closes trays/dialogs, releases the wake lock and clears
its displayed awake state. It renders no Spotify interface or keyboard controls while inactive. A fresh
`#apple-music` document never mounts Spotify or initializes its SDK.

The retained SDK uses `enableMediaSession: false`. ClassTempo owns Spotify’s OS control bindings only while
Spotify is active; guarded callbacks and cleanup prevent the hidden source from taking over Apple Music or
local-file commands. Failed-player recovery uses **Restart Spotify connection**, which reloads the document
while preserving tab authorization and saved cues, rather than constructing a second vendor player in the
same document. Normal source changes retain the selected track/list; an explicit reload does not promise to
preserve that temporary UI state.

## Account/app configuration

1. Use the eligible Spotify Premium account in https://developer.spotify.com/dashboard. Register a developer
   application truthfully describing ClassTempo and the intended use. Do not accept legal agreements for the owner.
2. Select Web API and Web Playback SDK. Register the exact HTTPS redirect URI:
   `https://rudilopez.github.io/classtempo/`. Privacy URL: `https://rudilopez.github.io/classtempo/spotify-privacy.html`.
3. For local development, separately register `http://127.0.0.1:5173/`; Spotify rejects localhost aliases.
4. Add approved test accounts to the developer allowlist. Current development access is limited to five users
   and requires the app owner’s Premium subscription; this is not public production access.
5. Add the app’s **public client ID** as GitHub Actions repository variable `SPOTIFY_CLIENT_ID`. The deployment
   passes it as VITE_SPOTIFY_CLIENT_ID, with the production redirect URI. No client secret is used or published.
6. Local dev can set VITE_SPOTIFY_CLIENT_ID and VITE_SPOTIFY_REDIRECT_URI in an ignored `.env.local`. Never put
   real tokens, passwords or a client secret in source, fixtures, chat, diagnostics or screenshots.
7. Deploy after required checks and verify the exact deployment. Missing configuration is intentional and must
   not show a fake successful connection or play a preview disguised as a full song.

## Authorization and privacy

The integration uses Authorization Code + PKCE S256 with state validation and a ten-minute single-use verifier.
Required SDK scopes are streaming, user-read-private and user-read-email per Spotify’s official how-to. ClassTempo
never independently retrieves or stores email. Read-only library/playlist scopes enable browsing; playback scope
starts tracks only on this browser device. No library/playlist write permission is requested.

Tokens remain in sessionStorage. Disconnect invalidates pending auth/refresh and clears Spotify tokens, lists and
saved Spotify cues. For full grant revocation, remove ClassTempo in Spotify’s connected-app settings. The public
privacy page explains the distinction. No imported file or Apple data is cleared.

## Regression and remaining acceptance

Implementation verification, October 28, 2026: typecheck, all 545 tests and production build passed for PR #41,
including idle-pause/error-loop correction and cancellation regression tests. An earlier mocked SDK/API
browser run verified paused song selection, first Play at a prepared cue, playing/paused cue behavior,
pending-start cancellation, disconnect and source exit. Loaded-artwork main layouts passed at twelve sizes;
Stage and the upfront choices passed at seven phone/tablet/desktop sizes. The unconfigured release screen
keeps all choices visible at 360×640 and disables Continue. These mock checks use no real Spotify credentials or
protected audio and do not establish account eligibility, audible playback or physical-device acceptance.

- Authorize a real eligible account, browse catalog/saved songs/playlists, select a track paused and explicitly Play.
- Confirm a complete subscribed song at 100%, not only the preview or metadata. Verify source attribution/track link.
- Set empty cues; jump while playing and paused, including before the first Play. Pause during pending Play/seek,
  switch sources and reject stale callbacks. Connecting/selecting must not transfer or interrupt another device.
- Test unavailable Premium/allowlist, expired/revoked authorization, network/rate limits, SDK not-ready and denied autoplay.
- Check the phone-first required layouts, main player, Stage cue/tools trays and focus behavior. Spotify artwork
  remains uncropped/unblurred and separate from titles/controls; missing images preserve usable controls.
- On physical iPhone and Android, test speaker/Bluetooth, interruptions/background/lock, and source exit. Desktop
  and mocked SDK checks establish implementation behavior only, not audible/phone acceptance.

## Official references

- https://developer.spotify.com/documentation/web-playback-sdk/reference
- https://developer.spotify.com/documentation/web-playback-sdk/howtos/web-app-player
- https://developer.spotify.com/documentation/web-api/tutorials/code-pkce-flow
- https://developer.spotify.com/documentation/web-api/concepts/redirect_uri
- https://developer.spotify.com/documentation/web-api/concepts/quota-modes
- https://developer.spotify.com/documentation/design
- https://developer.spotify.com/policy
