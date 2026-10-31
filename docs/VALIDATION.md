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

## Live acceptance: October 31, 2026

Run on hassan_an4s from 18:20 to 18:32 UTC, with a Confidential Twitch developer application registered for http://localhost:4317/auth/callback, OAuth connected from Settings, and OBS streaming a test scene with the Called It overlay as a browser source.

- Chat status showed Listening to chat. stream.online opened a live session at 18:20:25 UTC; stream.offline closed it at 18:32:30 UTC, and the ended session stays reviewable.
- Settings for a two-person test: 2 votes within 20 seconds, 30 second cooldown. Voters were the broadcaster (hassan_an4s) and one other consenting account. This is smaller than the planned 3-viewer test.
- The detector fired 4 times, each on 2 distinct voters, with the first caller recorded correctly.
- The first 3 moments (18:24:10, 18:25:21 and 18:28:42 UTC) ended as failed with "Twitch did not confirm the clip within 15 seconds". Create Clip returned a clip ID each time, but Get Clips never returned those clips, and none exists on the channel afterwards. The overlay correctly showed nothing for these. A direct Create Clip call made at about 18:27 UTC, between two of these failures, was confirmed in 6.4 seconds, so the cause is not simply stream age; it remains undetermined.
- The 4th moment (18:30:02 UTC) was confirmed: https://www.twitch.tv/hassan_an4s/clip/SpeedyAverageSamosaSpicyBoy-_OkqjPqIJJt0VUmx. The overlay showed Clip saved, called first by hassan_an4s, on the live stream, and the top callers list updated.
- Not separately verified: that repeated votes during the cooldown produce no duplicate clip.

The demo video records this run from the public channel page: https://youtu.be/UTxhRNXssV0

Follow-up worth considering: a longer or configurable confirmation window, and an overlay or dashboard hint when Twitch accepts a clip it never makes available.

Replay fixtures are authored synthetic timelines with fictional viewers. No real chat recording is bundled. A consented, anonymized capture can be added later with accurate provenance.
