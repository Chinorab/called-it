import "./style.css";
import {
  defaults,
  type Snapshot,
  type Session,
  type Moment,
  type Reason,
} from "../src/model.js";
const app = document.querySelector<HTMLDivElement>("#app")!;
const overlay = location.pathname === "/overlay";
const escape = (v: unknown) =>
  String(v ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ]!,
  );
const paths: Record<string, string> = {
  play: '<path d="M7 4.5v15l12.5-7.5z"/>',
  edit: '<path d="M4 20h4L19 9l-4-4L4 16zM14 6l4 4"/>',
  remove: '<circle cx="12" cy="12" r="9"/><path d="M8 12h8"/>',
  restore: '<path d="M3 10a9 9 0 1 1 2 8M3 4v6h6"/>',
  external:
    '<path d="M14 3h7v7M21 3l-11 11M10 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-5"/>',
  clip: '<circle cx="6" cy="7" r="3"/><circle cx="6" cy="17" r="3"/><path d="M8.6 8.6L19 19M8.6 15.4L19 5"/>',
  copy: '<rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2"/>',
  arrow: '<path d="M19 12H5M11 6l-6 6 6 6"/>',
  spike: '<path d="M3 17l6-6 4 4 8-8M14 7h7v7"/>',
  votes:
    '<path d="M9 11l3 3L22 4M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/>',
  emotes:
    '<path d="M12 3v4M12 17v4M3 12h4M17 12h4M5.6 5.6l2.8 2.8M15.6 15.6l2.8 2.8M5.6 18.4l2.8-2.8M15.6 8.4l2.8-2.8"/>',
};
const icon = (name: string) =>
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
  (paths[name] ?? paths.clip) +
  "</svg>";
const labels: Record<Reason, string> = {
  spike: "Chat spike",
  votes: "Command votes",
  emotes: "Emote burst",
};
let state: Snapshot;
let selectedSession = "";
let filter = "all";
let sort = "intensity";
let signature = "";
let dirty = false;
let connected = false;
let toastTimer: ReturnType<typeof setTimeout>;
let noticeTimer: ReturnType<typeof setTimeout>;
let reconnectTimer: ReturnType<typeof setTimeout>;
let ws: WebSocket;
const session = () =>
  state.sessions.find((s) => s.id === selectedSession) ||
  state.sessions.find((s) => s.id === state.activeId) ||
  state.sessions[0];
const calls = (s: Session | undefined) => {
  const map = new Map<string, { name: string; count: number }>();
  for (const m of s?.moments ?? [])
    if (m.status === "saved" || m.status === "replay") {
      const c = map.get(m.caller.id) ?? { name: m.caller.name, count: 0 };
      c.count++;
      map.set(m.caller.id, c);
    }
  return [...map.values()].sort(
    (a, b) => b.count - a.count || a.name.localeCompare(b.name),
  );
};
const elapsed = (ms: number) => {
  const sec = Math.max(0, Math.floor(ms / 1000));
  return [Math.floor(sec / 3600), Math.floor((sec % 3600) / 60), sec % 60]
    .map((n) => String(n).padStart(2, "0"))
    .join(":");
};
const time = (m: Moment, s: Session) => elapsed(m.at - s.startedAt);
const safeUrl = (value: string | undefined) => {
  try {
    const u = new URL(value!);
    return u.protocol === "https:" &&
      (u.hostname === "clips.twitch.tv" || u.hostname === "www.twitch.tv")
      ? u.href
      : "";
  } catch {
    return "";
  }
};
const safeImage = (value: string | undefined) => {
  try {
    const u = new URL(value!);
    return u.protocol === "https:" &&
      (u.hostname.endsWith(".jtvnw.net") || u.hostname.endsWith(".twitch.tv"))
      ? u.href
      : "";
  } catch {
    return "";
  }
};
const button = (action: string, text: string, style = "", id = "") =>
  '<button type="button" class="btn ' +
  style +
  '" data-action="' +
  action +
  '"' +
  (id ? ' data-id="' + escape(id) + '"' : "") +
  ">" +
  text +
  "</button>";
const iconButton = (action: string, name: string, label: string, id: string) =>
  '<button type="button" class="btn icon" data-action="' +
  action +
  '" data-id="' +
  escape(id) +
  '" aria-label="' +
  escape(label) +
  '" title="' +
  escape(label) +
  '">' +
  icon(name) +
  "</button>";
function notice(message: string) {
  const el = document.querySelector("#notice")!;
  el.textContent = message;
  clearTimeout(noticeTimer);
  noticeTimer = setTimeout(() => (el.textContent = ""), 6000);
}
async function api(path: string, method = "POST", data?: unknown) {
  const r = await fetch("/api/" + path, {
    method,
    headers: { "Content-Type": "application/json" },
    body: method === "GET" ? undefined : JSON.stringify(data ?? {}),
  });
  const result = await r.json();
  if (!r.ok) throw Error(result.error ?? "Request failed");
  return result;
}
const footer = () =>
  '<footer><div class="footer-inner"><span>Called It is not affiliated with Twitch.</span><nav aria-label="Footer"><a href="/privacy">Privacy</a><a href="/">Streams</a></nav></div></footer>';
function shell(content: string, mainClass = "") {
  app.innerHTML =
    '<a class="skip" href="#main">Skip to content</a><header><div class="header-inner"><a href="/" class="brand"><img src="/favicon.svg" alt="">Called It</a><nav aria-label="Main"><a href="/" ' +
    (location.pathname === "/" ? 'aria-current="page"' : "") +
    '>Streams</a><a href="/settings" ' +
    (location.pathname === "/settings" ? 'aria-current="page"' : "") +
    '>Settings</a></nav><div class="account"><span class="avatar" aria-hidden="true">' +
    escape(state.channel?.slice(0, 2).toUpperCase() ?? "CI") +
    "</span><span>" +
    escape(state.channel ?? "Local workspace") +
    '</span></div></div></header><main id="main" class="' +
    mainClass +
    '">' +
    content +
    "</main>" +
    footer() +
    '<dialog id="rename-dialog"><form id="rename-form"><h2>Rename moment</h2><p class="form-help">This title is saved in Called It.</p><label for="moment-title">Title</label><input name="title" id="moment-title" autocomplete="off" maxlength="100" required><input type="hidden" name="id"><div class="actions">' +
    button("cancel-rename", "Cancel") +
    '<button class="btn primary" type="submit">Save title</button></div></form></dialog>';
}
function gauge() {
  const m = state.metrics;
  return (
    '<div class="energy-heading"><span>Chat energy</span><span class="mono">' +
    (state.sessions.find((s) => s.id === state.activeId)?.mode === "replay" &&
    !state.replayRunning
      ? "Replay finished"
      : m.cooldownMs
        ? "Cooldown " + elapsed(m.cooldownMs).slice(3)
        : m.energy >= 70
          ? "Clipping"
          : m.energy > 30
            ? "Building"
            : m.warming
              ? "Learning baseline"
              : "Quiet") +
    '</span></div><div class="segments ' +
    (m.energy >= 70 ? "hot" : "") +
    '" role="meter" aria-label="Chat energy" aria-valuemin="0" aria-valuemax="100" aria-valuenow="' +
    m.energy +
    '">' +
    Array.from(
      { length: 20 },
      (_, i) =>
        '<i class="' + ((i + 1) * 5 <= m.energy ? "lit" : "") + '"></i>',
    ).join("") +
    "</div>"
  );
}
function statusBar() {
  const active = state.sessions.find((s) => s.id === state.activeId);
  return (
    '<section class="status-bar" aria-label="Session status"><div class="status-copy"><span class="status-label"><span class="dot"></span><span id="connection-text">' +
    escape(
      active?.mode === "replay"
        ? state.replayRunning
          ? "Replay running"
          : "Replay finished"
        : state.connection,
    ) +
    "</span></span><p>" +
    escape(
      active?.mode === "replay"
        ? "Authored chat timeline at 10× speed. No Twitch clips are created."
        : state.channel
          ? "Listening for the moments your chat calls."
          : "Connect Twitch for a live session, or run a replay to see it work.",
    ) +
    '</p></div><div id="dashboard-energy" class="inline-energy">' +
    gauge() +
    '</div><div class="actions">' +
    (state.replayRunning
      ? button("stop-replay", "Stop replay")
      : button("replay", icon("play") + "Run replay")) +
    (active?.mode === "replay"
      ? button("live", "Return to live")
      : !state.channel
        ? '<a class="btn primary" href="' +
          (state.configured ? "/auth/login" : "/settings") +
          '">' +
          (state.configured ? "Connect Twitch" : "Set up Twitch") +
          "</a>"
        : "") +
    "</div></section>"
  );
}
function spark(m: Moment) {
  const points = m.history
    .map(
      (v, i) =>
        ((i * 54) / Math.max(1, m.history.length - 1)).toFixed(1) +
        "," +
        (24 - v * 0.22).toFixed(1),
    )
    .join(" ");
  return (
    '<svg class="spark" viewBox="0 0 54 26" fill="none" aria-label="Recorded energy"><polyline points="' +
    points +
    '" stroke="#FF5A1F" stroke-width="1.5"/></svg>'
  );
}
function row(m: Moment, s: Session, rank: number) {
  const image = safeImage(m.thumbnail);
  return (
    '<article class="moment-grid moment-row ' +
    (m.discarded ? "discarded" : "") +
    '"><span class="rank">' +
    String(rank).padStart(2, "0") +
    '</span><a href="/moment/' +
    m.id +
    '" class="thumb" aria-label="Review ' +
    escape(m.title) +
    '">' +
    (image
      ? '<img src="' +
        escape(image) +
        '" alt="" loading="lazy" width="144" height="81">'
      : icon("play") +
        "<small>" +
        escape(m.status === "replay" ? "Replay moment" : m.status) +
        "</small>") +
    '</a><div><a href="/moment/' +
    m.id +
    '" class="moment-title">' +
    escape(m.title) +
    '</a><span class="moment-time mono">' +
    time(m, s) +
    " in stream</span>" +
    (m.discarded ? '<span class="sub">Removed from selection</span>' : "") +
    (m.error ? '<span class="sub error">' + escape(m.error) + "</span>" : "") +
    '</div><div><span class="caller">' +
    escape(m.caller.name) +
    '</span><span class="sub">called ' +
    (m.leadMs / 1000).toFixed(1) +
    ' s before</span></div><div class="reason">' +
    m.reasons.map((r) => "<div>" + labels[r] + "</div>").join("") +
    '<span class="sub">' +
    (m.status === "pending"
      ? "Confirming with Twitch"
      : m.status === "replay"
        ? "Replay"
        : m.status === "failed"
          ? "Not saved"
          : "Saved on Twitch") +
    '</span></div><div class="score-wrap"><span class="score">' +
    m.intensity +
    "</span>" +
    spark(m) +
    '</div><div class="actions row-actions"><a class="btn icon" href="/moment/' +
    m.id +
    '" aria-label="Review ' +
    escape(m.title) +
    '" title="Review">' +
    icon("play") +
    "</a>" +
    iconButton("rename", "edit", "Rename " + m.title, m.id) +
    iconButton(
      "discard",
      m.discarded ? "restore" : "remove",
      m.discarded ? "Restore moment" : "Remove from selection",
      m.id,
    ) +
    "</div></article>"
  );
}
function review() {
  const s = session();
  const moments = s?.moments ?? [];
  const saved = moments.filter(
    (m) => m.status === "saved" || m.status === "replay",
  );
  const top = calls(s)[0];
  const strongest = saved.length
    ? Math.max(...saved.map((m) => m.intensity))
    : null;
  const list = moments
    .filter((m) => filter === "all" || m.reasons.includes(filter as Reason))
    .sort((a, b) =>
      sort === "time" ? a.at - b.at : b.intensity - a.intensity || a.at - b.at,
    );
  shell(
    '<div class="intro"><div><div class="title-line"><h1>Stream review</h1>' +
      (s
        ? '<span class="badge ' +
          (s.mode === "replay" ? "replay" : "") +
          '">' +
          (s.mode === "replay" ? "Replay" : s.endedAt ? "Ended" : "Live") +
          "</span>"
        : "") +
      "</div><p>" +
      (s?.mode === "replay"
        ? "Clips ranked by how hard the recorded chat reacted."
        : s
          ? "Clips ranked by how hard your chat reacted."
          : "Your best moments start with a call from chat.") +
      "</p></div>" +
      (state.channel
        ? '<a class="btn" href="/settings">' + icon("copy") + "OBS setup</a>"
        : "") +
      "</div>" +
      statusBar() +
      '<dl class="stats"><div><dt>Clips kept</dt><dd class="display">' +
      saved.filter((m) => !m.discarded).length +
      '</dd></div><div><dt>Removed</dt><dd class="display">' +
      saved.filter((m) => m.discarded).length +
      "</dd></div><div><dt>Top caller</dt><dd>" +
      escape(top?.name ?? "No calls yet") +
      (top
        ? '<span class="sub accent">' +
          top.count +
          " " +
          (top.count === 1 ? "call" : "calls") +
          "</span>"
        : "") +
      '</dd></div><div><dt>Strongest moment</dt><dd class="mono">' +
      (strongest ?? "None yet") +
      '</dd></div></dl><div class="toolbar"><div class="actions" role="group" aria-label="Filter by trigger">' +
      [["all", "All moments"], ...Object.entries(labels)]
        .map(
          ([key, label]) =>
            '<button class="btn ' +
            (filter === key ? "active" : "") +
            '" data-filter="' +
            key +
            '" aria-pressed="' +
            (filter === key) +
            '">' +
            label +
            ' <span class="count">' +
            moments.filter(
              (m) => key === "all" || m.reasons.includes(key as Reason),
            ).length +
            "</span></button>",
        )
        .join("") +
      '</div><div class="actions" role="group" aria-label="Sort"><span class="muted">Sort</span>' +
      [
        ["intensity", "Intensity"],
        ["time", "Time"],
      ]
        .map(
          ([key, label]) =>
            '<button class="btn ' +
            (sort === key ? "active" : "") +
            '" data-sort="' +
            key +
            '" aria-pressed="' +
            (sort === key) +
            '">' +
            label +
            "</button>",
        )
        .join("") +
      '</div></div><section aria-label="Clipped moments"><div class="moment-grid column-head"><span>#</span><span>Clip</span><span>Moment</span><span>Credited to</span><span>Trigger</span><span>Intensity</span><span>Actions</span></div>' +
      (list.length
        ? list.map((m, i) => row(m, s!, i + 1)).join("")
        : '<div class="empty"><div class="empty-mark">' +
          icon("clip") +
          "</div><h2>" +
          (!s ? "Let chat call the moment." : "No moments in this view") +
          "</h2><p>" +
          (!s
            ? "When chat reacts together, Called It catches the moment and remembers who saw it first. Start with a replay, or connect your channel."
            : "Try another filter or let the session continue. Moments appear here when a signal reaches its threshold.") +
          "</p>" +
          button("replay", icon("play") + "Run a replay", "primary") +
          "</div>") +
      "</section>" +
      (state.sessions.length
        ? '<label class="session-picker">Session <select id="session-select">' +
          state.sessions
            .map(
              (entry) =>
                '<option value="' +
                entry.id +
                '" ' +
                (entry.id === s?.id ? "selected" : "") +
                ">" +
                escape(
                  entry.mode === "replay"
                    ? "Replay fixture"
                    : entry.channel +
                        " · " +
                        new Date(entry.startedAt).toLocaleString("en-GB"),
                ) +
                " · " +
                entry.moments.length +
                " moments</option>",
            )
            .join("") +
          "</select></label>"
        : ""),
  );
}
const num = (
  key: string,
  label: string,
  value: number,
  min: number,
  max: number,
  step = 1,
) =>
  '<label class="field" for="' +
  key +
  '"><span>' +
  label +
  '</span><input id="' +
  key +
  '" name="' +
  key +
  '" type="number" value="' +
  value +
  '" min="' +
  min +
  '" max="' +
  max +
  '" step="' +
  step +
  '" required></label>';
const check = (key: string, label: string, on: boolean) =>
  '<label class="check"><input name="' +
  key +
  '" type="checkbox" ' +
  (on ? "checked" : "") +
  ">" +
  label +
  "</label>";
function settings() {
  const s = state.settings;
  shell(
    '<div class="intro"><div><div class="title-line"><h1>Settings</h1></div><p>Applies from your next clip. No need to restart the stream.</p></div></div><section class="setting-row"><div><h2>Twitch connection</h2><p>Your own channel, your community.</p></div><div class="fields"><p>' +
      escape(
        state.channel
          ? "Connected as " + state.channel
          : state.configured
            ? "Ready to connect."
            : "Add your Twitch application credentials and encryption key to the local .env file, then restart Called It.",
      ) +
      '</p><p class="form-help">OAuth redirect URI: <code>http://localhost:4317/auth/callback</code></p><div class="actions">' +
      (state.channel
        ? button("disconnect", "Disconnect Twitch")
        : state.configured
          ? '<a class="btn primary" href="/auth/login">Connect Twitch</a>'
          : '<span class="badge">Setup required</span>') +
      '</div></div></section><form id="settings-form"><section class="setting-row"><div><h2>What counts</h2><p>Keep at least one signal on. Each signal can call a moment.</p></div><div class="fields">' +
      check("spike", "Chat spike", s.spike) +
      check("votes", "Command votes", s.votes) +
      check("emotes", "Emote burst", s.emotes) +
      '</div></section><section class="setting-row"><div><h2>Chat spike</h2><p>Message rate against your channel’s own recent baseline.</p></div><div class="fields">' +
      num("spikeRatio", "Rate multiplier", s.spikeRatio, 1.5, 20, 0.1) +
      num("minMessages", "Minimum messages", s.minMessages, 3, 1000) +
      num("minViewers", "Minimum distinct viewers", s.minViewers, 2, 200) +
      num("windowMs", "Reaction window in seconds", s.windowMs / 1000, 2, 60) +
      num(
        "baselineMs",
        "Baseline window in seconds",
        s.baselineMs / 1000,
        30,
        600,
      ) +
      num("warmupMs", "Warmup in seconds", s.warmupMs / 1000, 10, 120) +
      num(
        "baselineFloor",
        "Minimum baseline messages per second",
        s.baselineFloor,
        0.01,
        10,
        0.01,
      ) +
      '</div></section><section class="setting-row"><div><h2>Command votes</h2><p>One vote per viewer in the active window.</p></div><div class="fields">' +
      num("voteThreshold", "Distinct votes needed", s.voteThreshold, 2, 200) +
      num(
        "voteWindowMs",
        "Vote window in seconds",
        s.voteWindowMs / 1000,
        2,
        60,
      ) +
      '<label class="field" for="command">Chat command<input id="command" name="command" type="text" value="' +
      escape(s.command) +
      '" pattern="![a-zA-Z0-9]{2,20}" maxlength="21" autocomplete="off" spellcheck="false" required></label><p class="form-help">Start with ! followed by 2 to 20 letters or numbers.</p></div></section><section class="setting-row"><div><h2>Emote burst</h2><p>The same Twitch emote from several viewers.</p></div><div class="fields">' +
      num("emoteViewers", "Distinct viewers needed", s.emoteViewers, 2, 200) +
      num(
        "emoteShare",
        "Share of messages in percent",
        s.emoteShare * 100,
        10,
        100,
      ) +
      '</div></section><section class="setting-row"><div><h2>Minimum gap between clips</h2><p>Chat sees the countdown on the gauge.</p></div><div class="fields">' +
      num("cooldownMs", "Cooldown in seconds", s.cooldownMs / 1000, 10, 600) +
      '</div></section><section class="setting-row"><div><h2>Overlay</h2><p>Add the link as a browser source, 1920 by 1080.</p></div><div class="fields"><label for="overlay-url">Browser source link</label><input class="wide-input mono" id="overlay-url" type="text" readonly value="' +
      escape(state.overlayUrl) +
      '"><div class="actions">' +
      button("copy-overlay", icon("copy") + "Copy link") +
      '<a class="btn" href="' +
      escape(state.overlayUrl) +
      '" target="_blank" rel="noopener">Preview overlay</a>' +
      button("rotate-overlay", "Reset link") +
      '</div><fieldset><legend>Notification corner</legend><label class="check"><input type="radio" name="corner" value="left" ' +
      (s.corner === "left" ? "checked" : "") +
      '>Bottom left</label><label class="check"><input type="radio" name="corner" value="right" ' +
      (s.corner === "right" ? "checked" : "") +
      ">Bottom right</label></fieldset>" +
      check("showGauge", "Show the chat energy gauge", s.showGauge) +
      check("showCallers", "Show top callers", s.showCallers) +
      '</div></section><div class="save-bar"><span id="save-status" role="status" class="muted">All changes saved</span><div class="actions">' +
      button("defaults", "Reset to defaults") +
      '<button class="btn primary" type="submit">Save changes</button></div></div></form>',
    "settings-main",
  );
}
function privacy() {
  shell(
    '<div class="title-line"><h1>Privacy</h1></div><p>Your stream data stays on your computer.</p><section><h2>What Called It stores</h2><p>Called It keeps channel identity, session times, clip metadata, credited viewer IDs and display names, trigger measurements, settings, and your selection of moments in its local data folder. It does not send this information to an analytics service.</p></section><section><h2>Chat is processed in memory</h2><p>Message text and Twitch emote IDs are held briefly in a rolling window for detection, then dropped from that window. Raw live chat is not written to disk by default. Replay uses fictional viewers from labeled test fixtures.</p></section><section><h2>Twitch access</h2><p>Called It requests permission to read chat and create clips. Access and refresh tokens are encrypted on disk with AES 256 GCM using a separate key from your local environment. Tokens and your client secret never go to the dashboard or overlay. Your Twitch clips are hosted by Twitch and follow Twitch’s privacy rules.</p></section><section><h2>Viewer credit</h2><p>The overlay can display a viewer’s Twitch name when their message calls a saved moment. The optional callers board shows session totals. Let your community know when you use Called It.</p></section><section><h2>Your controls</h2><p>Disconnect Twitch in Settings to remove local credentials and request token revocation. You can also revoke access in Twitch Connections. Resetting the overlay link invalidates the previous link. Clearing history removes local moment records; it does not delete clips on Twitch.</p><div class="actions" style="margin-top:20px">' +
      button("clear-history", "Clear local history") +
      "</div></section><section><h2>Local use</h2><p>The server listens only on your computer. The dashboard uses a local session cookie. The overlay uses a separate read only key. Anyone with access to your computer or overlay link may see the information available to that view. No advertising cookies or third party analytics are used.</p></section>",
    "privacy",
  );
}
function detail() {
  const id = location.pathname.split("/")[2];
  const s = state.sessions.find((s) => s.moments.some((m) => m.id === id));
  const m = s?.moments.find((m) => m.id === id);
  if (!m || !s) {
    shell(
      '<h1>Moment not found</h1><p>Return to Streams to review available moments.</p><a class="btn" href="/">Streams</a>',
    );
    return;
  }
  const url = safeUrl(m.url),
    img = safeImage(m.thumbnail);
  shell(
    '<a href="/" class="btn">' +
      icon("arrow") +
      'Stream review</a><div class="title-line" style="margin-top:32px"><h1>' +
      escape(m.title) +
      '</h1><span class="badge ' +
      (s.mode === "replay" ? "replay" : "") +
      '">' +
      escape(s.mode === "replay" ? "Replay" : m.status) +
      "</span></div><p>" +
      time(m, s) +
      " into the stream. Called first by " +
      escape(m.caller.name) +
      '.</p><div class="detail-panel"><div class="detail-preview">' +
      (img
        ? '<img src="' + escape(img) + '" alt="Clip thumbnail">'
        : icon("play")) +
      (url
        ? '<a class="btn primary" href="' +
          escape(url) +
          '" target="_blank" rel="noopener noreferrer">' +
          icon("external") +
          "Open on Twitch</a>"
        : "<p>" +
          escape(
            m.status === "replay"
              ? "Replay moment. No video was created."
              : (m.error ?? "Waiting for Twitch confirmation."),
          ) +
          "</p>") +
      '</div><dl class="detail-facts"><div><dt>Intensity</dt><dd class="display accent" style="font-size:40px">' +
      m.intensity +
      "</dd></div><div><dt>Credited viewer</dt><dd>" +
      escape(m.caller.name) +
      "</dd></div><div><dt>Trigger</dt><dd>" +
      m.reasons.map((r) => labels[r]).join(", ") +
      "</dd></div><div><dt>First call</dt><dd>" +
      (m.leadMs / 1000).toFixed(1) +
      " s before detection</dd></div><div><dt>Rate</dt><dd>" +
      m.metrics.rate.toFixed(2) +
      " messages per second</dd></div><div><dt>Baseline</dt><dd>" +
      m.metrics.baseline.toFixed(2) +
      " messages per second</dd></div><div><dt>Distinct votes</dt><dd>" +
      m.metrics.votes +
      "</dd></div><div><dt>Emote viewers</dt><dd>" +
      m.metrics.emoteViewers +
      '</dd></div></dl></div><div class="actions">' +
      button("rename", icon("edit") + "Rename moment", "", m.id) +
      button(
        "discard",
        icon(m.discarded ? "restore" : "remove") +
          (m.discarded ? "Restore moment" : "Remove from selection"),
        "",
        m.id,
      ) +
      '</div><section class="explanation" style="margin-top:32px"><h2>Why this moment fired</h2><p>' +
      m.reasons
        .map((r) =>
          r === "spike"
            ? "Chat reached " +
              m.metrics.ratio.toFixed(1) +
              " times its preceding baseline."
            : r === "votes"
              ? m.metrics.votes +
                " distinct viewers called the command within the vote window."
              : m.metrics.emoteViewers +
                " distinct viewers shared an emote across " +
                Math.round(m.metrics.emoteShare * 100) +
                " percent of recent messages.",
        )
        .join(" ") +
      "</p><p>Intensity measures signal strength against the configured thresholds. A qualifying signal reaches 70; stronger reactions can reach 100.</p></section>",
    "detail-main",
  );
}
function render(force = false) {
  if (!state) return;
  if (overlay) {
    renderOverlay();
    return;
  }
  const next = JSON.stringify([
    state.sessions,
    state.channel,
    state.configured,
    state.replayRunning,
    state.settings,
    state.overlayUrl,
    state.activeId,
    selectedSession,
    filter,
    sort,
  ]);
  if (!force && next === signature) {
    updateLiveParts();
    return;
  }
  if (document.querySelector<HTMLDialogElement>("dialog")?.open) return;
  if (location.pathname === "/settings" && dirty) {
    updateLiveParts();
    return;
  }
  signature = next;
  if (location.pathname === "/settings") settings();
  else if (location.pathname === "/privacy") privacy();
  else if (location.pathname.startsWith("/moment/")) detail();
  else review();
  updateLiveParts();
}
function updateLiveParts() {
  const meter = document.querySelector("#dashboard-energy");
  if (meter) meter.innerHTML = gauge();
  const label = document.querySelector("#connection-text");
  if (label)
    label.textContent = !connected
      ? "Dashboard reconnecting"
      : state.sessions.find((s) => s.id === state.activeId)?.mode === "replay"
        ? state.replayRunning
          ? "Replay running"
          : "Replay finished"
        : state.connection;
}
function renderOverlay() {
  document.documentElement.classList.add("overlay-page");
  if (!document.querySelector(".overlay-wrap"))
    app.innerHTML =
      '<div class="overlay-wrap"><div id="overlay-mode"></div><div id="overlay-toast"></div><div id="overlay-gauge" class="overlay-panel overlay-energy"></div><div id="overlay-board"></div><div id="overlay-status"></div></div>';
  const wrap = document.querySelector(".overlay-wrap")!;
  wrap.classList.toggle("right", state.settings.corner === "right");
  const active = state.sessions.find((s) => s.id === state.activeId);
  document.querySelector("#overlay-mode")!.innerHTML =
    active?.mode === "replay"
      ? '<span class="overlay-label">Replay · No Twitch clips created</span>'
      : "";
  const meter = document.querySelector<HTMLElement>("#overlay-gauge")!;
  meter.hidden = !state.settings.showGauge;
  meter.innerHTML = gauge();
  document.querySelector("#overlay-board")!.innerHTML = state.settings
    .showCallers
    ? '<section class="overlay-panel overlay-board"><div class="board-heading"><h2>Top callers</h2><span>' +
      (active?.mode === "replay" ? "This replay" : "This stream") +
      "</span></div>" +
      (calls(active).length
        ? "<ol>" +
          calls(active)
            .slice(0, 3)
            .map(
              (c, i) =>
                "<li><span>" +
                (i + 1) +
                "</span><b>" +
                escape(c.name) +
                "</b><strong>" +
                c.count +
                "</strong></li>",
            )
            .join("") +
          "</ol>"
        : "<p>Waiting for the first call.</p>") +
      "</section>"
    : "";
  document.querySelector("#overlay-status")!.innerHTML = !connected
    ? '<span class="overlay-connection">Reconnecting</span>'
    : active?.mode === "replay"
      ? ""
      : state.connection !== "Listening to chat"
        ? '<span class="overlay-connection">' +
          escape(state.connection) +
          "</span>"
        : "";
}
function showMoment(m: Moment) {
  if (!overlay) return;
  const el = document.querySelector("#overlay-toast")!;
  const active = state.sessions.find((s) => s.id === state.activeId);
  const count = calls(active).find((c) => c.name === m.caller.name)?.count ?? 1;
  el.innerHTML =
    '<section class="overlay-panel overlay-notification" role="status"><div class="notification-content"><div class="scissors">' +
    icon("clip") +
    '</div><div class="notification-text"><h2>' +
    (m.status === "replay" ? "Replay moment" : "Clip saved") +
    "</h2><p>Called first by <strong>" +
    escape(m.caller.name) +
    '</strong></p></div><div class="notification-count"><strong>' +
    count +
    "</strong><small>" +
    (count === 1 ? "first call" : "calls this stream") +
    '</small></div></div><div class="drain"></div></section>';
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (el.innerHTML = ""), 4000);
}
function connect() {
  const key = location.hash.slice(1);
  if (overlay && !key) {
    document.documentElement.classList.add("overlay-page");
    app.innerHTML =
      '<span class="overlay-connection">Copy the overlay link from Settings.</span>';
    return;
  }
  ws = new WebSocket(
    "ws://" +
      location.host +
      "/ws" +
      (overlay ? "?role=overlay&key=" + encodeURIComponent(key) : ""),
  );
  ws.onopen = () => {
    connected = true;
  };
  ws.onmessage = (e) => {
    const packet = JSON.parse(e.data);
    if (packet.type === "snapshot") {
      state = packet.data;
      render();
    } else if (packet.type === "moment") showMoment(packet.data);
  };
  ws.onclose = (e) => {
    connected = false;
    if (state) render();
    if (e.code === 4001) {
      app.innerHTML =
        '<span class="overlay-connection">Overlay link changed. Copy the new link from Settings.</span>';
      return;
    }
    clearTimeout(reconnectTimer);
    reconnectTimer = setTimeout(connect, 2000);
  };
  ws.onerror = () => ws.close();
}
document.addEventListener("click", async (e) => {
  const target = (e.target as Element).closest<HTMLElement>("button");
  if (!target) return;
  const action = target.dataset.action;
  try {
    if (target.dataset.filter) {
      filter = target.dataset.filter;
      render(true);
      return;
    }
    if (target.dataset.sort) {
      sort = target.dataset.sort;
      render(true);
      return;
    }
    const id = target.dataset.id;
    if (action === "replay") {
      selectedSession = "";
      await api("replay/start");
    }
    if (action === "stop-replay") await api("replay/stop");
    if (action === "live") {
      selectedSession = "";
      await api("live");
    }
    if (action === "rename") {
      const m = state.sessions
        .flatMap((s) => s.moments)
        .find((m) => m.id === id)!;
      const form = document.querySelector<HTMLFormElement>("#rename-form")!;
      (form.elements.namedItem("title") as HTMLInputElement).value = m.title;
      (form.elements.namedItem("id") as HTMLInputElement).value = m.id;
      document.querySelector<HTMLDialogElement>("#rename-dialog")!.showModal();
    }
    if (action === "cancel-rename")
      document.querySelector<HTMLDialogElement>("#rename-dialog")!.close();
    if (action === "discard") {
      const m = state.sessions
        .flatMap((s) => s.moments)
        .find((m) => m.id === id)!;
      await api("moments/" + id, "PATCH", { discarded: !m.discarded });
      notice(
        m.discarded
          ? "Moment restored"
          : "Removed from selection. Use Restore to undo.",
      );
    }
    if (action === "copy-overlay") {
      await navigator.clipboard.writeText(state.overlayUrl!);
      notice("Overlay link copied");
    }
    if (action === "rotate-overlay") {
      await api("overlay/rotate");
      notice("Overlay link reset. Update your OBS source.");
    }
    if (action === "disconnect") {
      await api("disconnect");
      notice("Twitch disconnected");
    }
    if (action === "defaults") {
      const current = state.settings;
      state.settings = { ...defaults };
      dirty = false;
      settings();
      state.settings = current;
      dirty = true;
      document.querySelector("#save-status")!.textContent = "Unsaved changes";
    }
    if (
      action === "clear-history" &&
      confirm(
        "Clear all local session history? Twitch clips will remain available.",
      )
    ) {
      await api("history", "DELETE");
      notice("Local history cleared");
    }
  } catch (err) {
    notice(err instanceof Error ? err.message : "Action failed");
  }
});
document.addEventListener("change", (e) => {
  const target = e.target as HTMLInputElement;
  if (target.id === "session-select") {
    selectedSession = target.value;
    render(true);
  }
});
document.addEventListener("input", (e) => {
  if ((e.target as Element).closest("#settings-form")) {
    dirty = true;
    document.querySelector("#save-status")!.textContent = "Unsaved changes";
  }
});
document.addEventListener("submit", async (e) => {
  const form = e.target as HTMLFormElement;
  e.preventDefault();
  const submit = form.querySelector<HTMLButtonElement>("[type=submit]");
  if (submit) submit.disabled = true;
  try {
    const data = new FormData(form);
    if (form.getAttribute("id") === "settings-form") {
      const next: any = {};
      for (const [key, value] of Object.entries(defaults)) {
        if (typeof value === "boolean") next[key] = data.has(key);
        else if (typeof value === "number")
          next[key] =
            Number(data.get(key)) *
            (key.endsWith("Ms") ? 1000 : key === "emoteShare" ? 0.01 : 1);
        else next[key] = data.get(key);
      }
      await api("settings", "PUT", next);
      dirty = false;
      state.settings = next;
      render(true);
      notice("Settings saved");
    }
    if (form.getAttribute("id") === "rename-form") {
      await api("moments/" + data.get("id"), "PATCH", {
        title: String(data.get("title")).trim(),
      });
      document.querySelector<HTMLDialogElement>("#rename-dialog")!.close();
      render(true);
      notice("Moment renamed");
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : "Save failed";
    notice(message);
    if (form.getAttribute("id") === "settings-form") {
      document.querySelector("#save-status")!.textContent = message;
      form.querySelector<HTMLInputElement>("input:invalid")?.focus();
    }
  } finally {
    if (submit) submit.disabled = false;
  }
});
window.addEventListener("beforeunload", (e) => {
  if (dirty) {
    e.preventDefault();
    e.returnValue = "";
  }
});
app.innerHTML = overlay
  ? ""
  : "<main><h1>Called It</h1><p>Connecting to your local workspace…</p></main>";
connect();
