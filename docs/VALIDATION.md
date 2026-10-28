# Validation record

Date: October 28, 2026. Local Windows environment, Node.js 24.18.0, Chrome through Playwright CLI.

## Automated checks

- 26 unit and integration tests passed: detector fixtures, duplicate viewers and IDs, late messages, exact window and cooldown boundaries, signal combinations, command matching, deterministic replay, schema validation, EventSub subscriptions and handoff, shared chat filtering, revocation, encrypted vault, offline streams, rate limiting, concurrent refresh, ambiguous clip failure and bounded confirmation, HTTP origin and Host validation, distinct dashboard/overlay authorization, and overlay key rotation.
- TypeScript type checking and Vite production build passed.
- npm dependency audit reported zero known vulnerabilities at installation time. This is a point in time package check, not a security certification.

## Browser checks

Playwright CLI against the real local server verified:

- Empty state with no invented activity.
- Replay produces command, spike and emote moments.
- Rename persists, remove changes selection, and restore reverses removal.
- Trigger filter narrows the list.
- Moment detail explains metrics and clearly discloses replay with no Twitch clip link.
- Settings save and survive reload, then reset to defaults.
- Privacy page renders.
- Dashboard layouts at 1440 by 1000, 1280 by 800 and 1920 by 1080.
- OBS overlay at 1920 by 1080 has transparent document and body backgrounds and no page overflow.
- Overlay receives a real local WebSocket event, displays the first caller Fern, and labels the outcome Replay moment.

Raw screenshots are local QA artifacts in output/playwright and are not committed. The reviewed, clearly labeled replay dashboard screenshot is published in docs/screenshots. The Settings screenshot includes a private local overlay link; do not publish it. The overlay key is rotated after testing.

## Public repository and CI

Public repository: https://github.com/Chinorab/called-it

GitHub Actions passed dependency installation, all 26 tests, and the production build on Ubuntu with Node.js 24: https://github.com/Chinorab/called-it/actions/runs/40676998412

## Live acceptance: still required

No live OAuth or real Twitch clip is claimed by these checks. The entrant has not yet supplied local developer application credentials.

1. Register the Twitch application using http://localhost:4317/auth/callback.
2. Fill .env privately, generate the encryption key, restart and connect hassan_an4s.
3. Verify chat status says Listening to chat. Go live with original content and clips enabled.
4. For a small controlled demo, set 3 votes within 20 seconds. Have 3 distinct consenting viewers type !clip; note the first voter.
5. Verify exactly one confirmed clip, the matching Twitch URL, first caller notification and session count.
6. Repeat votes during cooldown and verify no duplicate clip.
7. End the stream and verify the ended session remains reviewable.
8. Record the actual outcome, clip URL, timestamp and any issues here; then record the demo script.

Replay fixtures are authored synthetic timelines with fictional viewers. No real chat recording is bundled. A consented, anonymized capture can be added later with accurate provenance.
