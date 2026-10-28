import {
  defaults,
  type ChatMessage,
  type Detection,
  type Metrics,
  type Settings,
  type Reason,
} from "./model.js";
/** Pure timestamp driven detector. No wall clock, network, random IDs or persistence. */
export class Detector {
  private messages: ChatMessage[] = [];
  private seen = new Map<string, number>();
  private lastAt = -Infinity;
  private startedAt: number;
  private firedAt = -Infinity;
  private eligibleAfter = -Infinity;
  constructor(
    public settings: Settings = { ...defaults },
    startedAt = 0,
  ) {
    this.startedAt = startedAt;
  }
  configure(settings: Settings) {
    this.settings = settings;
  }
  private prune(at: number) {
    const oldest =
      at -
      this.settings.baselineMs -
      Math.max(this.settings.windowMs, this.settings.voteWindowMs);
    this.messages = this.messages.filter((m) => m.at > oldest);
    for (const [id, t] of this.seen) if (t <= oldest) this.seen.delete(id);
  }
  private observe(at: number) {
    const s = this.settings;
    const fresh = this.messages.filter((m) => m.at > this.eligibleAfter);
    const active = fresh.filter((m) => m.at > at - s.windowMs && m.at <= at);
    const baselineMessages = this.messages.filter(
      (m) => m.at > at - s.windowMs - s.baselineMs && m.at <= at - s.windowMs,
    );
    const baselineSeconds =
      Math.min(s.baselineMs, Math.max(0, at - s.windowMs - this.startedAt)) /
      1000;
    const baseline = baselineSeconds
      ? baselineMessages.length / baselineSeconds
      : 0;
    const rate = active.length / (s.windowMs / 1000);
    const ratio = rate / Math.max(s.baselineFloor, baseline);
    const voters = new Map<string, ChatMessage>();
    for (const m of fresh)
      if (
        m.at > at - s.voteWindowMs &&
        m.at <= at &&
        m.text.trim().split(/\s+/)[0]?.toLowerCase() ===
          s.command.toLowerCase() &&
        !voters.has(m.userId)
      )
        voters.set(m.userId, m);
    const emotes = new Map<
      string,
      { viewers: Set<string>; messages: number }
    >();
    for (const m of active)
      for (const emote of new Set(m.emotes)) {
        const stat = emotes.get(emote) ?? {
          viewers: new Set<string>(),
          messages: 0,
        };
        stat.viewers.add(m.userId);
        stat.messages++;
        emotes.set(emote, stat);
      }
    const strongest = [...emotes.values()].sort(
      (a, b) => b.viewers.size - a.viewers.size || b.messages - a.messages,
    )[0];
    const emoteViewers = strongest?.viewers.size ?? 0,
      emoteShare = active.length
        ? (strongest?.messages ?? 0) / active.length
        : 0;
    const warming = baselineSeconds < s.warmupMs / 1000;
    const enough =
      active.length >= s.minMessages &&
      new Set(active.map((m) => m.userId)).size >= s.minViewers;
    const spikeStrength =
      s.spike && !warming
        ? Math.min(
            ratio / s.spikeRatio,
            active.length / s.minMessages,
            new Set(active.map((m) => m.userId)).size / s.minViewers,
          )
        : 0;
    const emoteStrength = s.emotes
      ? Math.min(emoteViewers / s.emoteViewers, emoteShare / s.emoteShare)
      : 0;
    const voteStrength = s.votes ? voters.size / s.voteThreshold : 0;
    const cooldownMs = Math.max(0, this.firedAt + s.cooldownMs - at);
    const metrics: Metrics = {
      energy: Math.min(
        100,
        Math.round(70 * Math.max(spikeStrength, emoteStrength, voteStrength)),
      ),
      rate,
      baseline,
      ratio,
      votes: voters.size,
      emoteViewers,
      emoteShare,
      warming,
      cooldownMs,
    };
    const reasons: Reason[] = [];
    if (s.spike && !warming && enough && ratio >= s.spikeRatio)
      reasons.push("spike");
    if (s.votes && voters.size >= s.voteThreshold) reasons.push("votes");
    if (
      s.emotes &&
      emoteViewers >= s.emoteViewers &&
      emoteShare >= s.emoteShare
    )
      reasons.push("emotes");
    // Identify the start of the accelerated run, rather than crediting an
    // unrelated quiet message that happens to remain in the reaction window.
    let firstReaction = active[0];
    if (reasons.includes("spike") && active.length > 1) {
      const maximumGap = Math.max(
        250,
        1000 / (Math.max(s.baselineFloor, baseline) * s.spikeRatio),
      );
      let start = active.length - 1;
      while (start > 0 && active[start].at - active[start - 1].at <= maximumGap)
        start--;
      firstReaction = active[start];
    } else if (reasons.includes("emotes")) {
      const emoteId = [...emotes.entries()].find(
        ([, value]) => value === strongest,
      )?.[0];
      firstReaction =
        active.find((message) => message.emotes.includes(emoteId ?? "")) ??
        firstReaction;
    }
    return {
      metrics,
      reasons,
      caller: [...voters.values()][0] ?? firstReaction,
    };
  }
  metrics(at: number): Metrics {
    this.prune(at);
    return this.observe(at).metrics;
  }
  push(message: ChatMessage): Detection | undefined {
    if (
      !Number.isFinite(message.at) ||
      message.at < this.lastAt ||
      this.seen.has(message.id)
    )
      return;
    this.lastAt = message.at;
    this.prune(message.at);
    this.seen.set(message.id, message.at);
    this.messages.push(message);
    if (message.at < this.firedAt + this.settings.cooldownMs) {
      this.eligibleAfter = message.at;
      return;
    }
    const { metrics, reasons, caller } = this.observe(message.at);
    if (!reasons.length || !caller) return;
    this.firedAt = message.at;
    this.eligibleAfter = message.at;
    return {
      at: message.at,
      caller: { id: caller.userId, name: caller.name },
      leadMs: message.at - caller.at,
      reasons,
      intensity: Math.min(
        100,
        Math.round(
          70 *
            Math.max(
              reasons.includes("spike")
                ? metrics.ratio / this.settings.spikeRatio
                : 0,
              reasons.includes("votes")
                ? metrics.votes / this.settings.voteThreshold
                : 0,
              reasons.includes("emotes")
                ? metrics.emoteViewers / this.settings.emoteViewers
                : 0,
            ),
        ),
      ),
      metrics,
    };
  }
}
