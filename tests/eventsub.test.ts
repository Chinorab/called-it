import { test } from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import type WebSocket from "ws";
import { EventSub } from "../src/eventsub.js";
import type { Twitch } from "../src/twitch.js";
class Socket extends EventEmitter {
  closed = false;
  close() {
    this.closed = true;
    this.emit("close");
  }
  terminate() {
    this.close();
  }
  sendPacket(type: string, payload: unknown, id = "event") {
    this.emit(
      "message",
      Buffer.from(
        JSON.stringify({
          metadata: {
            message_type: type,
            message_id: id,
            message_timestamp: "2026-10-28T10:00:00.000Z",
          },
          payload,
        }),
      ),
    );
  }
}
const flush = () => new Promise((r) => setTimeout(r, 10));
function setup() {
  const sockets: Socket[] = [];
  const requests: any[] = [];
  const chats: any[] = [];
  const streams: any[] = [];
  const statuses: string[] = [];
  let cleared = false;
  const twitch = {
    tokens: { userId: "123" },
    api: async (path: string, method?: string, body?: unknown) => {
      requests.push({ path, method, body });
      return { data: [] };
    },
    clear: () => {
      cleared = true;
    },
  } as unknown as Twitch;
  const service = new EventSub(
    twitch,
    (m) => chats.push(m),
    (online, at) => streams.push({ online, at }),
    (s) => statuses.push(s),
    () => {
      const socket = new Socket();
      sockets.push(socket);
      return socket as unknown as WebSocket;
    },
  );
  return {
    service,
    sockets,
    requests,
    chats,
    streams,
    statuses,
    cleared: () => cleared,
  };
}
const welcome = (s: Socket) =>
  s.sendPacket("session_welcome", {
    session: { id: "session", keepalive_timeout_seconds: 30 },
  });
const event = {
  broadcaster_user_id: "123",
  chatter_user_id: "viewer",
  chatter_user_name: "Fern",
  message_id: "message",
  message: {
    text: "!clip",
    fragments: [{ type: "emote", emote: { id: "emote1" } }],
  },
};
test("welcome creates chat and stream lifecycle subscriptions", async () => {
  const t = setup();
  try {
    t.service.start();
    welcome(t.sockets[0]);
    await flush();
    assert.deepEqual(
      t.requests.slice(0, 3).map((r) => r.body.type),
      ["channel.chat.message", "stream.online", "stream.offline"],
    );
    assert.equal(t.requests[0].body.condition.user_id, "123");
    assert.equal(t.statuses.at(-1), "Listening to chat");
    assert.equal(t.streams[0].online, false);
  } finally {
    t.service.stop();
  }
});
test("notifications deduplicate and filter other channel shared chat", async () => {
  const t = setup();
  try {
    t.service.start();
    welcome(t.sockets[0]);
    await flush();
    const s = t.sockets[0];
    const payload = { subscription: { type: "channel.chat.message" }, event };
    s.sendPacket("notification", payload, "one");
    s.sendPacket("notification", payload, "one");
    s.sendPacket(
      "notification",
      { ...payload, event: { ...event, source_broadcaster_user_id: "other" } },
      "two",
    );
    assert.equal(t.chats.length, 1);
    assert.deepEqual(t.chats[0].emotes, ["emote1"]);
  } finally {
    t.service.stop();
  }
});
test("reconnect handoff retains subscriptions and closes the old socket only after welcome", async () => {
  const t = setup();
  try {
    t.service.start();
    welcome(t.sockets[0]);
    await flush();
    t.sockets[0].sendPacket("session_reconnect", {
      session: { reconnect_url: "wss://eventsub.wss.twitch.tv/reconnect/test" },
    });
    assert.equal(t.sockets[0].closed, false);
    welcome(t.sockets[1]);
    await flush();
    assert.equal(t.sockets[0].closed, true);
    assert.equal(t.requests.filter((r) => r.method === "POST").length, 3);
  } finally {
    t.service.stop();
  }
});
test("revocation stops ingestion and clears authorization", async () => {
  const t = setup();
  t.service.start();
  t.sockets[0].sendPacket("revocation", {});
  assert.equal(t.cleared(), true);
  assert.equal(t.sockets[0].closed, true);
  t.service.stop();
});
