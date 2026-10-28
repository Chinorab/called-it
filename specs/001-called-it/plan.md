# Implementation plan

1. Preserve design, extract self hosted licensed fonts and tokens. Write specification, architecture and task acceptance gates.
2. Build pure TypeScript detector and deterministic recorded test fixtures before connecting Twitch.
3. Add Node HTTP and WebSocket server, persistent sessions, validated settings, encrypted token vault, OAuth, refresh and token validation.
4. Add EventSub welcome/subscription, keepalive, message deduplication, reconnect handoff, recovery and revocation handling. Add stream online/offline subscriptions and startup stream lookup.
5. Implement serialized clip creation and confirmation, rate limit handling, bounded failures and session credits.
6. Build dashboard, clip detail, settings, privacy and transparent overlay from supplied boards. Add isolated replay controller.
7. Run unit and integration checks, production build and Playwright CLI desktop/OBS verification. Fix observed issues.
8. Complete sourced README with Mermaid architecture, API/scopes table, OBS setup, replay guide, environment variables and limits; MIT license; DEVPOST.md; 2:35 scene by scene demo script.
9. Publish public GitHub repository after a valid login and selected owner are available. Capture real live validation with the entrant; do not claim it happened before it did.

## Architecture
Browser dashboard and OBS overlay connect to a loopback Node server via HTTP and WebSocket. EventSub and replay adapters normalize messages into the pure detector. A session coordinator persists moments and delegates live requests to a Helix clip service. Token vault uses AES 256 GCM with a separate environment key. Runtime data and all credentials are gitignored. Frontend uses TypeScript and native DOM APIs with Vite; no frontend framework is needed for these focused views.

## Confirmed decisions
Local app on the streaming computer. Channel hassan_an4s. Public repository Chinorab/called-it. Channel points deferred. OAuth redirect http://localhost:4317/auth/callback. Entrant will register the application and enter credentials in .env privately.
