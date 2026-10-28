import "dotenv/config";
import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from "node:http";
import { readFileSync, existsSync } from "node:fs";
import { resolve, extname } from "node:path";
import { randomBytes, timingSafeEqual } from "node:crypto";
import { WebSocketServer, WebSocket } from "ws";
import { z } from "zod";
import { Store, Vault } from "./storage.js";
import { Twitch, SCOPES } from "./twitch.js";
import { EventSub } from "./eventsub.js";
import { Coordinator } from "./coordinator.js";
import { settingsSchema } from "./model.js";
const port = Number(process.env.PORT ?? 4317);
const base = new URL(process.env.BASE_URL ?? "http://localhost:" + port);
if (base.origin !== "http://localhost:" + port)
  throw Error("Local app requires BASE_URL=http://localhost:" + port);
const store = new Store(resolve("data"));
const configured = !!(
  process.env.TWITCH_CLIENT_ID &&
  process.env.TWITCH_CLIENT_SECRET &&
  process.env.TOKEN_ENCRYPTION_KEY
);
const twitch = configured
  ? new Twitch(
      process.env.TWITCH_CLIENT_ID!,
      process.env.TWITCH_CLIENT_SECRET!,
      base.origin + "/auth/callback",
      new Vault(
        resolve("data/tokens.enc"),
        Buffer.from(process.env.TOKEN_ENCRYPTION_KEY!, "base64"),
      ),
    )
  : undefined;
const coordinator = new Coordinator(store, twitch);
const sessionKey = randomBytes(32).toString("hex");
const same = (a: string | undefined, b: string) => {
  const left = Buffer.from(a ?? "");
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
};
const cookies = (req: IncomingMessage) =>
  Object.fromEntries(
    (req.headers.cookie ?? "").split(";").map((v) => v.trim().split("=")),
  );
const authorized = (req: IncomingMessage) =>
  same(cookies(req).called_it, sessionKey);
let oauthState: { value: string; expires: number } | undefined;
const sockets = new Map<WebSocket, "dashboard" | "overlay">();
const wss = new WebSocketServer({ noServer: true, maxPayload: 2048 });
const overlayUrl = () => base.origin + "/overlay#" + store.overlayKey;
const snapshot = (role: "dashboard" | "overlay") => {
  const s = coordinator.snapshot();
  if (role === "dashboard") return { ...s, overlayUrl: overlayUrl() };
  return {
    ...s,
    sessions: s.sessions
      .filter((session) => session.id === s.activeId)
      .map((session) => ({
        ...session,
        moments: session.moments
          .filter((m) => m.status === "saved" || m.status === "replay")
          .map(({ error, clipId, url, thumbnail, ...m }) => m),
      })),
  };
};
coordinator.onChange = (notification) => {
  for (const [ws, role] of sockets)
    if (ws.readyState === WebSocket.OPEN) {
      if (ws.bufferedAmount > 1000000) {
        ws.terminate();
        continue;
      }
      ws.send(JSON.stringify({ type: "snapshot", data: snapshot(role) }));
      if (notification && notification.sessionId === coordinator.active?.id)
        ws.send(JSON.stringify({ type: "moment", data: notification.moment }));
    }
};
const eventsub = twitch
  ? new EventSub(
      twitch,
      (m) => coordinator.chat(m),
      (online, at) => coordinator.setStream(online, at),
      (status) => {
        coordinator.connection = status;
        coordinator.onChange();
      },
    )
  : undefined;
if (twitch)
  twitch.onInvalid = () => {
    eventsub?.stop();
    coordinator.setStream(false);
    coordinator.connection = "Connect Twitch again";
    coordinator.onChange();
  };
const json = (res: ServerResponse, status: number, data: unknown) => {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(data));
};
async function body(req: IncomingMessage) {
  let value = "";
  for await (const chunk of req) {
    value += chunk;
    if (value.length > 16000) throw Error("Request too large");
  }
  return value ? JSON.parse(value) : {};
}
const server = createServer(async (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Referrer-Policy", "no-referrer");
  res.setHeader(
    "Content-Security-Policy",
    "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' https://*.jtvnw.net https://*.twitch.tv; font-src 'self'; connect-src 'self' ws://localhost:" +
      port +
      "; object-src 'none'; base-uri 'none'; frame-ancestors 'self'",
  );
  if (req.headers.host !== base.host) {
    json(res, 403, { error: "Invalid host" });
    return;
  }
  const url = new URL(req.url ?? "/", base);
  try {
    if (
      req.method === "GET" &&
      !url.pathname.startsWith("/api/") &&
      !url.pathname.startsWith("/auth/")
    ) {
      if (url.pathname !== "/overlay")
        res.setHeader(
          "Set-Cookie",
          "called_it=" + sessionKey + "; HttpOnly; SameSite=Strict; Path=/",
        );
    }
    if (url.pathname.startsWith("/api/") && !authorized(req)) {
      json(res, 401, { error: "Open the dashboard first" });
      return;
    }
    if (
      req.method !== "GET" &&
      (req.headers.origin !== base.origin ||
        req.headers["content-type"] !== "application/json")
    ) {
      json(res, 403, { error: "Invalid request origin" });
      return;
    }
    if (url.pathname === "/auth/login" && req.method === "GET") {
      if (!authorized(req)) throw Error("Open the dashboard first");
      if (!twitch)
        throw Error(
          "Add Twitch credentials and an encryption key to .env, then restart the app",
        );
      oauthState = {
        value: randomBytes(32).toString("hex"),
        expires: Date.now() + 600000,
      };
      const auth = new URL("https://id.twitch.tv/oauth2/authorize");
      auth.search = new URLSearchParams({
        client_id: twitch.clientId,
        redirect_uri: base.origin + "/auth/callback",
        response_type: "code",
        scope: SCOPES.join(" "),
        state: oauthState.value,
        force_verify: "true",
      }).toString();
      // A separate Lax cookie binds the external OAuth return to this browser.
      res.setHeader(
        "Set-Cookie",
        "called_it_oauth=" +
          oauthState.value +
          "; HttpOnly; SameSite=Lax; Path=/auth; Max-Age=600",
      );
      res.writeHead(302, { Location: auth.href });
      res.end();
      return;
    }
    if (url.pathname === "/auth/callback" && req.method === "GET") {
      const state = oauthState;
      oauthState = undefined;
      if (
        !state ||
        Date.now() > state.expires ||
        !same(url.searchParams.get("state") ?? undefined, state.value) ||
        !same(cookies(req).called_it_oauth, state.value)
      )
        throw Error("OAuth session expired. Connect again.");
      if (url.searchParams.has("error"))
        throw Error("Twitch connection was declined");
      const code = url.searchParams.get("code");
      if (!code || !twitch) throw Error("Missing Twitch authorization");
      await twitch.exchange(code);
      if (
        process.env.TWITCH_CHANNEL &&
        twitch.tokens?.login.toLowerCase() !==
          process.env.TWITCH_CHANNEL.toLowerCase()
      ) {
        await twitch.disconnect();
        throw Error("Connect the Twitch channel configured in .env");
      }
      eventsub!.start();
      res.setHeader(
        "Set-Cookie",
        "called_it=" + sessionKey + "; HttpOnly; SameSite=Strict; Path=/",
      );
      res.writeHead(302, { Location: "/" });
      res.end();
      return;
    }
    if (url.pathname === "/api/state" && req.method === "GET") {
      json(res, 200, snapshot("dashboard"));
      return;
    }
    if (url.pathname === "/api/settings" && req.method === "PUT") {
      store.settings = settingsSchema.parse(await body(req));
      coordinator.configure();
      json(res, 200, { ok: true });
      return;
    }
    if (url.pathname === "/api/replay/start" && req.method === "POST") {
      coordinator.startReplay();
      json(res, 200, { ok: true });
      return;
    }
    if (url.pathname === "/api/replay/stop" && req.method === "POST") {
      coordinator.stopReplay();
      json(res, 200, { ok: true });
      return;
    }
    if (url.pathname === "/api/live" && req.method === "POST") {
      coordinator.returnLive();
      json(res, 200, { ok: true });
      return;
    }
    if (url.pathname === "/api/disconnect" && req.method === "POST") {
      await twitch?.disconnect();
      json(res, 200, { ok: true });
      return;
    }
    if (url.pathname === "/api/overlay/rotate" && req.method === "POST") {
      store.rotateOverlay();
      for (const [ws, role] of sockets)
        if (role === "overlay") ws.close(4001, "Overlay key changed");
      coordinator.onChange();
      json(res, 200, { ok: true });
      return;
    }
    if (url.pathname === "/api/history" && req.method === "DELETE") {
      if (coordinator.active && !coordinator.active.endedAt)
        throw Error("End the active session before clearing history");
      store.sessions = [];
      store.save();
      coordinator.onChange();
      json(res, 200, { ok: true });
      return;
    }
    const match = url.pathname.match(/^\/api\/moments\/([a-zA-Z0-9-]+)$/);
    if (match && req.method === "PATCH") {
      const patch = z
        .object({
          title: z.string().trim().min(1).max(100).optional(),
          discarded: z.boolean().optional(),
        })
        .strict()
        .parse(await body(req));
      const moment = store.sessions
        .flatMap((s) => s.moments)
        .find((m) => m.id === match[1]);
      if (!moment) {
        json(res, 404, { error: "Moment not found" });
        return;
      }
      Object.assign(moment, patch);
      store.save();
      coordinator.onChange();
      json(res, 200, { ok: true });
      return;
    }
    if (req.method !== "GET") {
      json(res, 404, { error: "Route not found" });
      return;
    }
    const asset =
      url.pathname.startsWith("/assets/") ||
      url.pathname.startsWith("/fonts/") ||
      url.pathname === "/favicon.svg";
    const root = resolve("dist");
    const file = resolve(
      root,
      asset ? "." + decodeURIComponent(url.pathname) : "index.html",
    );
    if (!file.startsWith(root + requireSeparator()) || !existsSync(file)) {
      json(res, 404, { error: "Build the app with npm run build first" });
      return;
    }
    const types: Record<string, string> = {
      ".html": "text/html; charset=utf-8",
      ".js": "text/javascript",
      ".css": "text/css",
      ".svg": "image/svg+xml",
      ".woff2": "font/woff2",
    };
    res.setHeader(
      "Content-Type",
      types[extname(file)] ?? "application/octet-stream",
    );
    res.end(readFileSync(file));
  } catch (e) {
    json(res, 400, {
      error:
        e instanceof z.ZodError
          ? e.issues.map((i) => i.path.join(".") + ": " + i.message).join("; ")
          : e instanceof Error
            ? e.message
            : "Request failed",
    });
  }
});
function requireSeparator() {
  return process.platform === "win32" ? "\\" : "/";
}
server.on("upgrade", (req, socket, head) => {
  const url = new URL(req.url ?? "/", base);
  if (
    req.headers.host !== base.host ||
    req.headers.origin !== base.origin ||
    url.pathname !== "/ws"
  ) {
    socket.destroy();
    return;
  }
  // Overlay role is selected explicitly even if OBS happens to carry a dashboard cookie.
  const role =
    url.searchParams.get("role") === "overlay" ? "overlay" : "dashboard";
  if (
    role === "dashboard"
      ? !authorized(req)
      : !same(url.searchParams.get("key") ?? undefined, store.overlayKey)
  ) {
    socket.destroy();
    return;
  }
  wss.handleUpgrade(req, socket, head, (ws) => {
    sockets.set(ws, role);
    ws.send(JSON.stringify({ type: "snapshot", data: snapshot(role) }));
    ws.on("close", () => sockets.delete(ws));
    ws.on("error", () => {});
  });
});
setInterval(() => coordinator.tick(), 1000).unref();
setInterval(() => {
  for (const ws of sockets.keys())
    if (ws.readyState === WebSocket.OPEN) ws.ping();
}, 30000).unref();
setInterval(() => {
  void twitch?.validate().catch(() => {
    coordinator.connection = "Twitch validation failed";
    coordinator.onChange();
  });
}, 3600000).unref();
server.listen(port, "127.0.0.1", () => {
  console.log("Called It: " + base.origin);
  if (twitch?.tokens)
    void twitch
      .validate()
      .then(() => eventsub!.start())
      .catch(() => {
        coordinator.connection = "Connect Twitch again";
      });
});
