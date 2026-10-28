import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { Detector } from "../src/detector.js";
import {
  defaults,
  settingsSchema,
  type ChatMessage,
  type Settings,
} from "../src/model.js";
const fixture = (name: string): ChatMessage[] =>
  JSON.parse(
    readFileSync(
      new URL("../fixtures/" + name + ".json", import.meta.url),
      "utf8",
    ),
  ).messages;
const run = (name: string, settings: Settings = { ...defaults }) => {
  const d = new Detector(settings);
  return fixture(name).flatMap((m) => {
    const event = d.push(m);
    return event ? [event] : [];
  });
};
test("a steady recorded timeline never triggers", () =>
  assert.equal(run("quiet").length, 0));
test("spike uses previous baseline and credits first message of accelerated run", () => {
  const events = run("spike");
  assert.equal(events.length, 1);
  assert.deepEqual(events[0].reasons, ["spike"]);
  assert.equal(events[0].caller.id, "viewer0");
  assert.ok(events[0].intensity > 70);
  assert.ok(events[0].metrics.ratio >= 3);
});
test("distinct command voters trigger once and credit first voter", () => {
  const events = run("votes");
  assert.equal(events.length, 1);
  assert.equal(events[0].caller.name, "Fern");
  assert.deepEqual(events[0].reasons, ["votes"]);
});
test("a single viewer repeating the command cannot reach threshold", () => {
  const d = new Detector();
  for (const m of fixture("votes"))
    assert.equal(d.push({ ...m, userId: "same" }), undefined);
});
test("duplicate event IDs and older timestamps are ignored", () => {
  const d = new Detector({ ...defaults, voteThreshold: 2 });
  const m = fixture("votes")[0];
  d.push(m);
  assert.equal(d.push({ ...m, userId: "different" }), undefined);
  assert.equal(
    d.push({ ...m, id: "old", at: 0, userId: "different" }),
    undefined,
  );
  assert.ok(d.push({ ...m, id: "next", at: 2000, userId: "different" }));
});
test("matching emotes count distinct viewers rather than repeated fragments", () => {
  assert.deepEqual(run("emotes")[0].reasons, ["emotes"]);
  const d = new Detector();
  for (const m of fixture("emotes"))
    assert.equal(
      d.push({ ...m, userId: "same", emotes: Array(20).fill("305954156") }),
      undefined,
    );
});
test("cooldown consumes votes and requires fresh votes at the boundary", () => {
  const d = new Detector({ ...defaults, voteThreshold: 2, cooldownMs: 10000 });
  const log = fixture("votes");
  assert.equal(d.push(log[0]), undefined);
  assert.ok(d.push(log[1]));
  for (const m of log.slice(2)) assert.equal(d.push(m), undefined);
  assert.equal(d.push({ ...log[0], id: "fresh1", at: 11700 }), undefined);
  assert.ok(d.push({ ...log[1], id: "fresh2", at: 11701 }));
});
test("votes expire at the exact left window boundary", () => {
  const d = new Detector({ ...defaults, voteThreshold: 2, voteWindowMs: 2000 });
  const [a, b] = fixture("votes");
  d.push(a);
  assert.equal(d.push({ ...b, at: a.at + 2000 }), undefined);
});
test("warmup suppresses spike without blocking explicit votes", () => {
  assert.equal(run("spike", { ...defaults, warmupMs: 120000 }).length, 0);
  assert.equal(run("votes", { ...defaults, warmupMs: 120000 }).length, 1);
});
test("simultaneous signals generate one event containing every satisfied reason", () => {
  const d = new Detector({ ...defaults, voteThreshold: 2, emoteViewers: 2 });
  const [a, b] = fixture("votes");
  d.push({ ...a, emotes: ["x"] });
  assert.deepEqual(d.push({ ...b, emotes: ["x"] })?.reasons, [
    "votes",
    "emotes",
  ]);
});
test("custom command uses an exact case insensitive first token", () => {
  const d = new Detector({ ...defaults, command: "!save", voteThreshold: 2 });
  const [a, b] = fixture("votes");
  assert.equal(d.push({ ...a, text: "!savewrong" }), undefined);
  assert.equal(d.push({ ...b, text: "!SAVE please" }), undefined);
  assert.ok(d.push({ ...a, id: "final", at: 3000, text: "!save" }));
});
test("replay is reproducible and includes all three trigger types", () => {
  const a = run("replay");
  assert.deepEqual(a, run("replay"));
  assert.deepEqual(
    a.map((m) => m.reasons[0]),
    ["votes", "spike", "emotes"],
  );
});
test("settings reject no signals and invalid windows", () => {
  assert.equal(
    settingsSchema.safeParse({
      ...defaults,
      spike: false,
      votes: false,
      emotes: false,
    }).success,
    false,
  );
  assert.equal(
    settingsSchema.safeParse({
      ...defaults,
      warmupMs: 120000,
      baselineMs: 30000,
    }).success,
    false,
  );
});
