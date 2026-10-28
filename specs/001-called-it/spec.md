# Called It specification

Status: local app confirmed by the entrant. Twitch channel hassan_an4s; public repository Chinorab/called-it; channel points deferred.

## Purpose
Give small streaming communities a collective clip button. Detect moments from chat, save a real Twitch clip, and credit the first viewer who called it.

## Constraints
Solo hackathon entry built in this Codex chat. English UI and documentation. Submission deadline supplied by the entrant: November 2, 2026 at 14:00 PST (22:00 UTC, 23:00 Paris). Preserve the session ID for submission. Never fabricate live validation, audience metrics, testimonials, or recordings.

## User stories and acceptance criteria
1. As a streamer, I connect my own Twitch channel using OAuth authorization code flow. Secrets remain server side, encrypted tokens persist outside version control, refresh is serialized, tokens are validated at startup and hourly, and disconnect revokes access and clears stored tokens.
2. As chat, our activity can trigger a moment through an enabled message rate spike, a shared emote burst, or distinct command votes. A pure detector consumes timestamped messages; identical ordered input and settings produce identical output. Duplicate IDs and late messages do not create extra moments. The baseline excludes the current reaction window and warms up before automatic spike detection.
3. As a viewer, I receive credit for the earliest command voter in the active window, otherwise the first message in the accelerated run for a spike, or the first contributing emote message. The accelerated run uses the trailing cluster with adjacent gaps no greater than max(250 ms, baseline expected interval / spike ratio). One moment yields one credit after a clip is confirmed. Counts belong to a session.
4. As a streamer, I see pending, saved, failed, and offline states. Clip requests are serialized. Cooldown begins when detection fires. Rate limit headers block subsequent attempts until reset. Ambiguous POST failures are not blindly retried. Only confirmed clips generate a saved notification.
5. As an OBS user, I add a transparent 1920 by 1080 browser source. It shows the credited viewer, energy, cooldown, connection state, and optional top callers. It reconnects and receives a current snapshot without replaying stale notifications. A separate read only overlay key cannot mutate settings or access tokens.
6. As a streamer, I review sessions and ranked moments, filter by trigger, sort by intensity or time, inspect details, rename locally, discard or restore locally, and open confirmed clips on Twitch. Review state survives restart. Empty states contain no sample metrics.
7. As a judge, I run a clearly labeled deterministic replay without credentials. Fixture timestamps drive the same detector. Replay outcomes never claim real Twitch clips, create Twitch URLs, or mix with live session statistics. Replay can be stopped and restarted.
8. As a streamer, I configure signal toggles, windows, minimum activity, spike ratio, distinct viewer counts, emote share, cooldown, command, overlay corner, energy visibility, and callers visibility. Server side validation rejects invalid combinations.
9. As a visitor, I can read a privacy page explaining stored metadata, transient chat processing, credential handling, local deletion, and Twitch independence.

## Algorithm contract
Default reaction window 10 seconds; preceding baseline 120 seconds; warmup 30 seconds. Spike: at least 12 messages from at least 3 viewers, and current rate at least 3 times the prior baseline rate with a configurable baseline floor. Emote burst: the same Twitch emote appears in messages from at least 5 distinct viewers and at least 60 percent of active messages contain that emote. Count messages and distinct viewers, not repeated emote fragments. Votes: 8 distinct viewers in 20 seconds using the exact first command token, case insensitive. Any enabled signal may trigger. Record every satisfied reason on a single moment. Default cooldown 90 seconds; consume windows when a moment fires, and require fresh activity after cooldown. Ignore messages during cooldown for triggering; they still contribute to the rolling baseline.

Intensity is a transparent normalized signal score, not a popularity or quality prediction. Each enabled signal has a strength equal to its observed value divided by its threshold, with eligibility gates. The strongest gated signal drives energy; a threshold maps to 70 of 100 and values saturate at 100. Intensity uses the strongest eligible rate ratio, vote count or emote viewer count relative to its threshold, multiplied by 70 and capped at 100. Store component observations and historical energy samples for explanation and real sparklines.

## Scope decisions
Local single streamer Node server binds to loopback. Dashboard bootstrap uses a local session and same origin mutation protections. OAuth uses the streamer's user token with user:read:chat and clips:edit. Optional channel points remain a separate followup until requested. No hosted multi tenant product, chat posting, or Twitch clip deletion in the MVP.

## Design
Reference: design/Called It.html, seven supplied boards. Background #0B0C0E, surface #17191C, border #24272C, text #ECEDEE, muted #A4A8AF, accent #FF5A1F. Archivo headings, Geist body, Geist Mono measurements. No purple gradients, pill buttons, emojis, dashes in authored UI copy, invented data, or AI references in UI. Accessible labels, keyboard focus, reduced motion, favicon, privacy, and honest loading/error/empty states are required.

## Validation
Recorded timeline fixtures: quiet baseline, spike, votes, duplicate voters, emote burst, cooldown, cooldown boundary, replay reset, out of order timestamps and duplicate IDs. Integration tests exercise refresh, rate limits, offline clips, pending confirmation and authorization boundaries with fake Twitch transport. Playwright CLI exercises dashboard, settings, replay, rename/discard/restore, details, privacy and overlay at desktop sizes and 1920 by 1080. Real OAuth and clip creation require the entrant's developer app and live channel, and are documented separately from mock validation.
