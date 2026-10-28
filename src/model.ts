import { z } from "zod";
export const settingsSchema = z
  .object({
    spike: z.boolean(),
    votes: z.boolean(),
    emotes: z.boolean(),
    windowMs: z.number().int().min(2000).max(60000),
    baselineMs: z.number().int().min(30000).max(600000),
    warmupMs: z.number().int().min(10000).max(120000),
    spikeRatio: z.number().min(1.5).max(20),
    baselineFloor: z.number().min(0.01).max(10),
    minMessages: z.number().int().min(3).max(1000),
    minViewers: z.number().int().min(2).max(200),
    voteWindowMs: z.number().int().min(2000).max(60000),
    voteThreshold: z.number().int().min(2).max(200),
    emoteViewers: z.number().int().min(2).max(200),
    emoteShare: z.number().min(0.1).max(1),
    cooldownMs: z.number().int().min(10000).max(600000),
    command: z.string().regex(/^![a-z0-9]{2,20}$/i),
    corner: z.enum(["left", "right"]),
    showGauge: z.boolean(),
    showCallers: z.boolean(),
  })
  .strict()
  .refine((s) => s.spike || s.votes || s.emotes, {
    message: "Enable at least one signal",
  })
  .refine((s) => s.warmupMs <= s.baselineMs, {
    message: "Warmup cannot exceed the baseline window",
  });
export type Settings = z.infer<typeof settingsSchema>;
export const defaults: Settings = {
  spike: true,
  votes: true,
  emotes: true,
  windowMs: 10000,
  baselineMs: 120000,
  warmupMs: 30000,
  spikeRatio: 3,
  baselineFloor: 0.1,
  minMessages: 12,
  minViewers: 3,
  voteWindowMs: 20000,
  voteThreshold: 8,
  emoteViewers: 5,
  emoteShare: 0.6,
  cooldownMs: 90000,
  command: "!clip",
  corner: "left",
  showGauge: true,
  showCallers: true,
};
export type ChatMessage = {
  id: string;
  at: number;
  userId: string;
  name: string;
  text: string;
  emotes: string[];
};
export type Reason = "spike" | "votes" | "emotes";
export type Metrics = {
  energy: number;
  rate: number;
  baseline: number;
  ratio: number;
  votes: number;
  emoteViewers: number;
  emoteShare: number;
  warming: boolean;
  cooldownMs: number;
};
export type Detection = {
  at: number;
  caller: { id: string; name: string };
  leadMs: number;
  reasons: Reason[];
  intensity: number;
  metrics: Metrics;
};
export type Moment = Detection & {
  id: string;
  title: string;
  status: "pending" | "saved" | "failed" | "replay";
  error?: string;
  url?: string;
  clipId?: string;
  thumbnail?: string;
  duration?: number;
  discarded: boolean;
  history: number[];
};
export type Session = {
  id: string;
  mode: "live" | "replay";
  channel: string;
  startedAt: number;
  endedAt?: number;
  moments: Moment[];
};
export type Snapshot = {
  settings: Settings;
  sessions: Session[];
  activeId?: string;
  metrics: Metrics;
  connection: string;
  channel?: string;
  configured: boolean;
  replayRunning: boolean;
  overlayUrl?: string;
};
