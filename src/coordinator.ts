import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { Detector } from "./detector.js";
import { Store } from "./storage.js";
import type { Twitch } from "./twitch.js";
import type { ChatMessage, Moment, Session, Snapshot } from "./model.js";
export class Coordinator {
  private live?: Session;
  private replay?: Session;
  private liveDetector: Detector;
  private replayDetector: Detector;
  private liveHistory: number[] = [];
  private replayHistory: number[] = [];
  private pending = false;
  private replayTimer?: NodeJS.Timeout;
  private replayAt = 0;
  connection = "Not connected";
  onChange = (_notification?: { sessionId: string; moment: Moment }) => {};
  constructor(
    public store: Store,
    public twitch?: Twitch,
  ) {
    this.liveDetector = new Detector(store.settings, Date.now());
    this.replayDetector = new Detector(store.settings, 0);
  }
  get replayRunning() {
    return !!this.replayTimer;
  }
  get active() {
    return this.replay ?? this.live;
  }
  get clock() {
    return this.replay ? this.replayAt : Date.now();
  }
  setStream(online: boolean, startedAt = Date.now()) {
    if (online) {
      if (this.live) return;
      const channel = this.twitch?.tokens?.login ?? "Twitch channel";
      this.live = this.store.sessions.find(
        (s) =>
          s.mode === "live" &&
          s.channel === channel &&
          !s.endedAt &&
          s.startedAt === startedAt,
      );
      if (!this.live) {
        this.live = {
          id: randomUUID(),
          mode: "live",
          channel,
          startedAt,
          moments: [],
        };
        this.store.sessions.unshift(this.live);
      }
      this.liveDetector = new Detector(this.store.settings, Date.now());
      this.liveHistory = [];
    } else if (this.live) {
      this.live.endedAt = Date.now();
      this.live = undefined;
    }
    this.store.save();
    this.onChange();
  }
  private async accept(message: ChatMessage, mode: "live" | "replay") {
    const session = mode === "live" ? this.live : this.replay;
    if (!session) return;
    const detector = mode === "live" ? this.liveDetector : this.replayDetector;
    const detection = detector.push(message);
    if (!detection) return;
    const moment: Moment = {
      ...detection,
      id: randomUUID(),
      title: detection.reasons.includes("votes")
        ? "Chat called it"
        : detection.reasons.includes("spike")
          ? "Chat went all in"
          : "An emote burst",
      status: mode === "replay" ? "replay" : "pending",
      discarded: false,
      history: [
        ...(mode === "live" ? this.liveHistory : this.replayHistory),
        detection.intensity,
      ].slice(-60),
    };
    session.moments.push(moment);
    this.store.save();
    this.onChange();
    if (mode === "replay") {
      this.onChange({ sessionId: session.id, moment });
      return;
    }
    if (this.pending) {
      moment.status = "failed";
      moment.error = "A clip is already being created";
      this.store.save();
      this.onChange();
      return;
    }
    this.pending = true;
    try {
      if (!this.twitch?.tokens) throw Error("Connect Twitch first");
      const result = await this.twitch.createClip(this.twitch.tokens.userId);
      Object.assign(moment, result, { status: "saved" });
      this.store.save();
      this.onChange({ sessionId: session.id, moment });
    } catch (e) {
      moment.status = "failed";
      moment.error = e instanceof Error ? e.message : "Clip creation failed";
      this.store.save();
      this.onChange();
    } finally {
      this.pending = false;
    }
  }
  chat(message: ChatMessage) {
    void this.accept(message, "live");
  }
  tick() {
    const m = this.snapshot().metrics;
    const history = this.replay ? this.replayHistory : this.liveHistory;
    history.push(m.energy);
    if (history.length > 60) history.shift();
    this.onChange();
  }
  configure() {
    this.liveDetector.configure(this.store.settings);
    this.replayDetector.configure(this.store.settings);
    this.store.save();
    this.onChange();
  }
  startReplay() {
    this.stopReplay();
    this.replayAt = 0;
    this.replayHistory = [];
    this.replayDetector = new Detector(this.store.settings, 0);
    this.replay = {
      id: randomUUID(),
      mode: "replay",
      channel: "Recorded fixture",
      startedAt: 0,
      moments: [],
    };
    this.store.sessions.unshift(this.replay);
    const messages = JSON.parse(
      readFileSync(new URL("../fixtures/replay.json", import.meta.url), "utf8"),
    ).messages as ChatMessage[];
    let index = 0;
    this.replayTimer = setInterval(() => {
      this.replayAt += 1000;
      while (index < messages.length && messages[index].at <= this.replayAt)
        void this.accept(messages[index++], "replay");
      this.replayHistory.push(
        this.replayDetector.metrics(this.replayAt).energy,
      );
      if (this.replayHistory.length > 60) this.replayHistory.shift();
      if (index === messages.length) {
        clearInterval(this.replayTimer);
        this.replayTimer = undefined;
        this.replay!.endedAt = this.replayAt;
        this.store.save();
      }
      this.onChange();
    }, 100);
    this.store.save();
    this.onChange();
  }
  stopReplay() {
    clearInterval(this.replayTimer);
    this.replayTimer = undefined;
    if (this.replay && !this.replay.endedAt)
      this.replay.endedAt = this.replayAt;
    this.store.save();
    this.onChange();
  }
  returnLive() {
    this.stopReplay();
    this.replay = undefined;
    this.onChange();
  }
  snapshot(): Snapshot {
    return {
      settings: this.store.settings,
      sessions: this.store.sessions,
      activeId: this.active?.id,
      metrics: (this.replay ? this.replayDetector : this.liveDetector).metrics(
        this.clock,
      ),
      connection: this.connection,
      channel: this.twitch?.tokens?.login,
      configured: !!this.twitch,
      replayRunning: this.replayRunning,
    };
  }
}
