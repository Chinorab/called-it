import WebSocket from "ws";
import { Twitch } from "./twitch.js";
import type { ChatMessage } from "./model.js";
export class EventSub {
  private socket?: WebSocket;
  private sockets = new Set<WebSocket>();
  private stopped = true;
  private retry?: NodeJS.Timeout;
  private retries = 0;
  private seen = new Map<string, number>();
  constructor(
    private twitch: Twitch,
    private onChat: (m: ChatMessage) => void,
    private onStream: (online: boolean, startedAt?: number) => void,
    private status: (s: string) => void,
    private openSocket: (url: string) => WebSocket = (url) =>
      new WebSocket(url),
  ) {}
  start() {
    this.stop();
    this.stopped = false;
    this.connect("wss://eventsub.wss.twitch.tv/ws", false);
  }
  stop() {
    this.stopped = true;
    clearTimeout(this.retry);
    this.retry = undefined;
    for (const s of this.sockets) s.terminate();
    this.sockets.clear();
    this.socket = undefined;
  }
  private reconnect() {
    if (this.stopped || this.retry) return;
    this.status("Reconnecting to chat");
    this.retry = setTimeout(
      () => {
        this.retry = undefined;
        this.connect("wss://eventsub.wss.twitch.tv/ws", false);
      },
      Math.min(30000, 1000 * 2 ** Math.min(this.retries++, 5)),
    );
  }
  private connect(url: string, handoff: boolean) {
    if (this.stopped) return;
    const previous = this.socket;
    const ws = this.openSocket(url);
    this.sockets.add(ws);
    if (!handoff) this.socket = ws;
    let welcomed = false;
    let timeoutSeconds = 10;
    let timer: NodeJS.Timeout;
    const arm = () => {
      clearTimeout(timer);
      timer = setTimeout(() => ws.terminate(), (timeoutSeconds + 2) * 1000);
    };
    arm();
    ws.on("message", async (raw) => {
      try {
        const packet = JSON.parse(raw.toString());
        const type = packet.metadata?.message_type;
        arm();
        if (type === "session_welcome") {
          welcomed = true;
          timeoutSeconds =
            packet.payload.session.keepalive_timeout_seconds ?? 30;
          arm();
          if (handoff) {
            this.socket = ws;
            previous?.close();
          } else {
            const userId = this.twitch.tokens?.userId;
            if (!userId) throw Error("Reconnect Twitch to read chat");
            for (const [event, condition] of [
              [
                "channel.chat.message",
                { broadcaster_user_id: userId, user_id: userId },
              ],
              ["stream.online", { broadcaster_user_id: userId }],
              ["stream.offline", { broadcaster_user_id: userId }],
            ] as const) {
              await this.twitch.api("eventsub/subscriptions", "POST", {
                type: event,
                version: "1",
                condition,
                transport: {
                  method: "websocket",
                  session_id: packet.payload.session.id,
                },
              });
            }
            const streams = await this.twitch.api("streams?user_id=" + userId);
            const live = streams.data?.[0];
            this.onStream(
              !!live,
              live ? Date.parse(live.started_at) : undefined,
            );
          }
          this.retries = 0;
          this.status("Listening to chat");
          return;
        }
        if (type === "session_reconnect") {
          const next = new URL(packet.payload.session.reconnect_url);
          if (
            next.protocol !== "wss:" ||
            next.hostname !== "eventsub.wss.twitch.tv"
          )
            throw Error("Invalid Twitch reconnect address");
          this.connect(next.href, true);
          return;
        }
        if (type === "revocation") {
          this.status("Twitch permission revoked. Connect again.");
          this.stop();
          this.twitch.clear();
          return;
        }
        if (type !== "notification") return;
        const id = packet.metadata.message_id;
        const now = Date.now();
        for (const [key, time] of this.seen)
          if (now - time > 600000) this.seen.delete(key);
        if (this.seen.has(id)) return;
        this.seen.set(id, now);
        const e = packet.payload.event;
        const subscription = packet.payload.subscription.type;
        if (subscription === "channel.chat.message") {
          // Shared chat messages originating in another channel must not affect this channel.
          if (
            e.source_broadcaster_user_id &&
            e.source_broadcaster_user_id !== e.broadcaster_user_id
          )
            return;
          this.onChat({
            id: e.message_id,
            at: Date.parse(packet.metadata.message_timestamp),
            userId: e.chatter_user_id,
            name: e.chatter_user_name,
            text: e.message.text,
            emotes: e.message.fragments
              .filter((f: any) => f.type === "emote")
              .map((f: any) => f.emote.id),
          });
        } else if (subscription === "stream.online")
          this.onStream(true, Date.parse(e.started_at));
        else if (subscription === "stream.offline") this.onStream(false);
      } catch {
        this.status("Chat connection failed. Retrying.");
        ws.terminate();
      }
    });
    ws.on("error", () => {});
    ws.on("close", () => {
      clearTimeout(timer);
      this.sockets.delete(ws);
      if (this.stopped) return;
      if (this.socket === ws || (!welcomed && handoff)) {
        if (previous && handoff) previous.terminate();
        this.reconnect();
      }
    });
  }
}
