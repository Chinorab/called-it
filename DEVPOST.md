# Called It

## Inspiration

Clips help a stream live beyond its broadcast. Twitch’s October 2026 Stream Recaps and Recaps Spotlight announcements made that opportunity clear. A small channel may have engaged viewers without a dedicated clipper. I wanted the people already reacting in chat to share that job, and to recognize the viewer who noticed the moment first.

## What it does

Called It listens to Twitch chat and detects collective moments from a rate spike against the channel’s own baseline, a shared emote burst, or enough distinct command voters. It requests a clip, waits for Twitch confirmation, then displays a transparent OBS notification crediting the first caller.

The dashboard ranks moments and explains their triggers. A streamer can rename local records, remove or restore moments in the selection, and open confirmed clips on Twitch. Settings control thresholds, cooldown and overlay presentation. A clearly labeled replay runs the same detector without credentials or a live stream.

## How we built it

I built this entry solo in one Codex chat. I used Codex to turn the brief into a specification and acceptance criteria, inspect the supplied design boards, verify Twitch documentation, implement the TypeScript detector and backend, build the dashboard and OBS overlay, and run automated tests and Playwright CLI checks. The specification, plan and task checklist remain in the repository. I will submit this chat’s actual session ID.

Node.js and TypeScript power OAuth authorization code flow, EventSub over WebSocket and Helix clip creation. The frontend uses TypeScript, native DOM APIs and Vite with self hosted fonts from the supplied design. A pure detector is shared by live chat and replay. Tokens remain on the local server and are encrypted at rest. Mock HTTP tests exercise error handling without creating real clips.

Codex handled implementation and verification in this chat. I supplied the product brief and visual direction, and I handle account setup, live test participants, the final recording and submission. Live acceptance results are tracked separately from replay and mocked tests in docs/VALIDATION.md.

## Challenges

A reaction means different things in different channels. Excluding the active reaction window from the baseline, requiring distinct viewers, and consuming activity during cooldown made detection understandable and testable.

Clip creation is asynchronous. A successful request alone cannot justify a saved notification. Called It waits for confirmation and has explicit paths for offline streams, clipping restrictions, rate limits, network errors and expired credentials. EventSub recovery and duplicate delivery also needed careful treatment.

Replay had to be honest. Fictional viewers are labeled, timestamps drive the real algorithm, and simulated outcomes cannot call Twitch or masquerade as live proof. Browser testing caught a form submission issue that unit tests did not expose.

## What’s next

Complete the live acceptance recording on hassan_an4s, tune thresholds with community feedback, add optional channel point redemptions and consented anonymized timeline recording, and improve the review workflow. Hosted multi streamer support would require separate account isolation and deployment work.

## Submission fields

- Public repository: https://github.com/Chinorab/called-it
- Codex session ID: copy the actual ID for this chat when submitting; no invented value.
- Demo: record docs/DEMO_SCRIPT.md and add the final video URL.
- Live validation: update docs/VALIDATION.md only after the real test.
- Deadline supplied by entrant: November 2, 2026, 2:00 pm PST, or 23:00 in Paris.
