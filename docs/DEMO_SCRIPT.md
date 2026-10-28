# Called It demo script

Target runtime: **2:35**, leaving 10 seconds under the 2:45 limit. English narration and captions. Record original screen footage and your own stream content. Use no music, or only music you own and can document permission for. Do not film credentials, .env contents, the encryption key, OAuth codes or the private overlay URL.

## Before recording

- Register and connect the Twitch app with http://localhost:4317/auth/callback.
- Enable clips and go live on hassan_an4s with content you own.
- Add Called It to OBS as a 1920 by 1080 browser source.
- Arrange at least three consenting test viewers with distinct Twitch accounts. For the demonstration set command votes to 3, the vote window to 20 seconds, and cooldown to 30 seconds. Show these actual settings briefly. One viewer repeating the command is not three votes.
- Use Return to live. Do not show a replay notification as proof of a Twitch clip.
- Capture a clean successful clip, its real Twitch URL, and the matching credited viewer before editing the demo. If live creation fails, fix it and retake this scene.
- End the broadcast before filming the end of stream review. Record a short view of this Codex chat and the passing test output, with sensitive details hidden.

| Time | Picture and actions | Narration |
| --- | --- | --- |
| 0:00–0:15 | Open on your own stream and an active chat. Briefly show the two Twitch blog headlines, with source links in the video description. | “Clips now help followers catch up and new viewers find a stream. But on a small channel, the best moment can pass without anyone clipping it. Called It lets chat do that job together.” |
| 0:15–0:30 | Show Called It’s dashboard, then Settings: 3 distinct votes in 20 seconds. Show OBS overlay on your own stream. | “It runs locally beside OBS. Chat can call a moment with command votes, a sudden message spike, or a shared emote burst. Every threshold is configurable for the channel.” |
| 0:30–0:55 | Live channel hassan_an4s. First test viewer types !clip; two other viewers follow. Keep chat names readable. Show the energy changing and the pending request. | “This is my live channel. Our first viewer calls it, then two other viewers agree. Repeating the command does not multiply a vote. Called It remembers the first caller and asks Twitch to create the clip.” |
| 0:55–1:15 | Hold on the real Clip saved overlay and credited name. Open the matching confirmed clip on Twitch and play a few seconds of your original content. | “The notification appears only after Twitch confirms the clip. There it is on Twitch, and the viewer who called it first gets the credit. The cooldown prevents one reaction from creating a pile of clips.” |
| 1:15–1:40 | End the stream. Show ranked moments, trigger details and caller. Rename a moment, remove it, then restore it. | “After the stream, the moments are ready to review. I can see what triggered each one, who called it, and how strongly chat reacted. I can rename my local selection, remove a moment, or open the real clip on Twitch.” |
| 1:40–2:00 | Run replay, keeping Replay labels visible. Show the three fixture trigger types and the transparent overlay. | “Judges can also try this without credentials or a live stream. Replay uses recorded fixture timestamps and the same detector. These are fictional test viewers, and replay never creates Twitch clips.” |
| 2:00–2:22 | Short footage of this Codex chat: written spec, detector implementation, test results, Playwright checks. Briefly show the architecture diagram. | “I built Called It solo in this Codex chat, starting with a specification and the supplied design. Codex helped implement the detector, Twitch integration and interface, then test the failure cases and verify the dashboard and overlay in a browser.” |
| 2:22–2:35 | Final frame with Called It mark, repository address and a real saved moment from the demonstration. | “Called It turns a shared reaction into a saved moment, and gives the first caller their credit. The code, setup guide and replay are available in the public repository.” |

## Editing and submission checklist

- Keep the first problem statement within 15 seconds and total video under 2:45.
- Use readable captions, real UI states and no fake viewer counts.
- Keep the live segment clearly distinct from replay. Label any time cuts.
- Do not claim measured audience growth or discovery results.
- Add the two Twitch blog source links from README to the video description.
- Replace the repository end card with the verified public URL.
- Add the final video URL to Devpost and submit the actual Codex chat session ID.
