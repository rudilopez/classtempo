# Spotify setup and verification

Status, October 28, 2026: the ClassTempo Spotify application is registered in Development mode, its exact
production redirect and SDK/API selections are verified, and its public client ID is configured in GitHub
Actions. The configured deployment succeeded, the owner manually approved ClassTempo’s OAuth consent, and the
callback and private-library reads succeeded. After PR #41 corrected idle pause/error-handler behavior,
ClassTempo played a complete real Spotify track at 100%, and the owner confirmed clear audio on Mac. Paused
selection, playing/paused cues, Stage and owned-playlist browsing were verified in that browser. PR #42’s
retained-player lifecycle is deployed: Spotify → Apple Music → Spotify now preserves paused offsets and
resumes only on explicit Play, with one SDK player and no new authorization prompt or error. Mac configuration
and control verification is complete; physical-phone, background, Bluetooth and lock-screen acceptance remain
pending. YouTube is a separate embedded-video source; see [YouTube setup](YOUTUBE_SETUP.md). App registration and the owner’s acceptance of
Spotify’s registration agreement do not establish Spotify approval of ClassTempo’s use case.

## Product limits

Spotify is hidden from ordinary local/Apple Music libraries and the public guide. Invited browsers see
Library → Spotify, which explains original-speed-only playback, Premium and internet requirements, unavailable
Practice/Stems/class plans/offline playback, and Spotify’s personal/noncommercial restriction. It offers Apple
Music (with a playlist-transfer explanation), Open a file, Library, or Continue at 100% when configured.
Unconfigured builds keep Continue disabled with an explicit setup message. The notice does not override provider
terms. Spotify’s standard developer policy excludes business-targeted uses including dance studios; confirm an
eligible use/agreement before enabling this integration for that purpose.

Development access can read playlist contents only where the signed-in user owns or collaborates on the
playlist. Followed Spotify/editorial playlists may be unavailable. The player explains this restriction on a
denied playlist request and offers another playlist, Search or Saved songs.

## Inviting testers

Choose the people deliberately; the link is not a public Spotify signup path. Each person needs their own
Spotify Premium account and approval in ClassTempo's Spotify developer application.

1. Get the email address associated with the tester's Spotify account. For known friends, do not ask for their
   name again; use the known name only if the dashboard requires it.
2. In Spotify Developer Dashboard, open ClassTempo → Settings → Users Management → Add new user. Add that
   approved account within the development allowance. Do not request the tester's password.
3. Send the tester this unlisted link: **https://rudilopez.github.io/classtempo/#spotify-invite**.
4. Have them open it in the browser they will use for ClassTempo. For an installed Home Screen app, they can
   instead open **Library → Tester access**, enter **FAMILIA** and tap **Continue**. The code ignores case
   and surrounding spaces and enters the same invitation route in that installation.
5. Spotify's limitations appear first. They choose Continue at 100%, connect that approved Spotify account on
   Spotify's page, select a song and press Play.

The invitation reveals Spotify on that browser and changes its route to `#spotify`; it does not sign anyone
in, add them to Spotify's allowlist, bypass Premium or change the five-user development restriction. The link
contains no account email, credential or unique access token. A forwarded link alone does not grant provider
access. No invitations are sent and no allowlist entries are changed by opening it.

After the invitation, **Library → Spotify** remains visible on that browser's later visits. The visibility
flag normally uses localStorage, with temporary session/document fallbacks if storage is unavailable. Another
browser, private browsing or cleared storage can require reopening the link or entering the tester code again.
Safari and an installed Home Screen app can have separate storage; grant visibility inside the installation
that will be used. The code is a UI-discovery convenience, not a password or provider entitlement.
Existing Spotify authorization or a bare `#spotify` URL does not grant this visibility.

In **Spotify options**, **Copy tester link** copies only the canonical invitation URL, excluding OAuth query
parameters. **Hide Spotify on this device** disconnects the tab's Spotify session, removes its tester visibility
and reloads the local player. It keeps saved Spotify cues, local files, classes and Apple Music settings.
The invitation can reveal Spotify again; the user must reconnect if the session was disconnected. Ordinary
**Disconnect** retains its existing behavior of clearing this browser's Spotify connection and cue data.

Private-discovery verification, October 28, 2026: typecheck, all 573 tests and the production build passed.
Chromium verified hidden local/Apple Music source entries, no Spotify adapter/SDK frame for an uninvited
`#spotify`, invitation consumption, remembered access after reload, source navigation, and Hide followed by
re-invitation. An existing saved local file remained available after Hide. Copy reported success and exposed
the clean link; unit coverage checks OAuth-query removal and the actual relative `./` production base under
`/classtempo/`. Public Library passed containment checks at seven phone/tablet/desktop sizes; the invitation
passed twelve sizes, including compact phone browser viewports. Options scroll internally at 360×640.
No account was added to Spotify's allowlist and no invitation was sent. The Mac audio acceptance below belongs
to the earlier playback release; physical-phone acceptance for this visibility change remains separate.

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
| Deployment | [Actions run 40781996193](https://github.com/rudilopez/classtempo/actions/runs/40781996193) succeeded on `08e1e55bc9d5cc8ccfb2ff21a121a5092d39de4d` after PR #42. Live `#spotify` enables Continue at 100%. |
| Automated checks | Typecheck, 552 tests and production build passed, including CI, for the deployed retained-player lifecycle. Coverage includes inactive OS-handler guards, disabled native Media Session ownership, paused cues, non-reentrant SDK errors and late REST cancellation. |
| Premium membership | The signed-in owner’s Spotify Account Overview confirms Premium Family. |
| Development users | User Management lists 0/5 explicit test users. The owner’s authorized Web API reads work without an explicit listed entry; this does not establish access for any other user. |
| Real account authorization | Verified: the owner manually approved ClassTempo’s OAuth consent, the callback succeeded, and the authorized UI shows Disconnect. No client secret was accessed. |
| Catalog and private-library reads | Verified: Search returned the requested “Que Fue Lo Que Me Hiciste” by Dalvin La Melodia; Saved songs returned 20 real saved tracks. Metadata access is separate from protected audio playback. |
| Protected player startup | Verified after PR #42: a fresh document initialized the SDK with native Media Session disabled and reached ready at 421 ms. Source returns retained exactly one `player_created`, one connect and one ready event, with no error events. No new native player or OAuth prompt appeared on return. |
| Paused song selection and cue | Verified after PR #41: a real song opened paused without `playback_error`; cue 1 at zero before first Play stayed paused and error-free. While playing, cue 1 sought to zero and kept playing; after Pause, cue 1 stayed at zero with Play shown. The test cue was cleared, leaving all eight slots empty. |
| Idle-pause/error-loop correction | PR #41 corrected pausing an inactive SDK player and repeated pause calls from SDK error handlers. The earlier pre-Play `playback_error` feedback loop did not recur in the fresh selection/cue test. |
| Real protected playback | PR #41 ran the real “Que Fue Lo Que Me Hiciste” track at 100% in ClassTempo on Mac through its natural 3:49.4 completion. After PR #42, explicit Play and visible playback progression worked after both source roundtrips below. |
| Listening acceptance | The owner answered “Yes, clear audio” for the PR #41 Mac test at 100%. PR #42 changes lifecycle and control ownership, with no further audio processing changes; its new evidence is playback progression and source recovery, not a new listening-acceptance claim. Physical-iPhone and other-device audio remain unaccepted. |
| Main player and Stage | Verified in the Mac browser, including a 390×664 phone-sized viewport: playback continued; Stage showed the cover and eight-button cue bar below it. Tools offered only Restart and Talk at fixed 100%. Leaving Stage preserved playback. This is responsive-layout evidence, not a physical-phone test. |
| Natural full-track completion | Verified on PR #41: the continuous run was observed at 3:41.4, then naturally returned to zero with Play shown at the 3:49.4 end. No next track started. |
| Owned playlists | Verified on PR #41: the provider playlist list returned 20 items; an owned playlist opened two track rows without errors while the selected song continued playing. |
| Source roundtrip | Verified live after PR #42: preparing 1.0 seconds before first Play preserved the song, 1.0-second offset and paused Play state across Spotify → Apple Music → Spotify; explicit Play then worked. A second roundtrip left during playback at 8.8 seconds and returned at 8.8 seconds with Play shown, paused; explicit Play worked again. |
| Test cleanup | All eight cue slots are empty after clearing test cues. Keep awake is off. |
| First-party comparison | Spotify’s own web player played the same song with a 3:49 duration, progressed from 18 to 37 seconds and showed “This web browser” as its current device. It was paused and closed. This comparison does not establish ClassTempo playback or listening acceptance. |
| Physical phones | Pending; physical iPhone/Android listening, background playback, Bluetooth, interruptions and lock-screen behavior remain separate acceptance checks. |

Do not mark pending rows complete from a successful app registration, deployment or consent screen alone.

## Source lifecycle and verification

PR #42 is deployed and its real Mac source roundtrips pass. The owner’s Mac 100% audio acceptance, cue, Stage,
playlist and full-track observations above belong to the earlier PR #41 baseline. PR #42 changes lifecycle and
control ownership without additional audio processing changes; its real playback progression and source-return
results are recorded separately above.

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

Earlier investigation found a pre-Play `playback_error` loop caused by pausing an inactive SDK player and
answering SDK errors with further pause calls; PR #41 corrected it. A later source return constructed a second
native player that reached ready at 895 ms but failed REST Play with a sanitized generic error. Its HTTP status
and cause were unconfirmed; PR #42 avoids that second constructor and passes the real roundtrip checks.
The original initial/same-page Retry 20-second startup stalls also have no confirmed cause. A fresh document
had subsequently reached ready at 552 ms before these lifecycle changes, and PR #42 reached ready at 421 ms.

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

Implementation verification, October 28, 2026: typecheck, all 552 tests and production build passed for PR #42,
including retained source ownership, idle-pause/error-loop correction and cancellation regression tests. An earlier mocked SDK/API
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
