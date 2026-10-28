import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { randomBytes } from "node:crypto";
import { Vault } from "../src/storage.js";
import { Twitch } from "../src/twitch.js";
const tokens = {
  access_token: "test-access",
  refresh_token: "test-refresh",
  userId: "123",
  login: "test_channel",
};
const make = (request: typeof fetch) => {
  mkdirSync("work/tests", { recursive: true });
  const file = join(mkdtempSync(join("work/tests", "called-it-")), "vault.enc");
  const vault = new Vault(file, randomBytes(32));
  vault.save(tokens);
  return {
    twitch: new Twitch(
      "client",
      "secret",
      "http://localhost:4317/auth/callback",
      vault,
      request,
      async () => {},
    ),
    vault,
    file,
  };
};
const response = (data: unknown, status = 200, headers = {}) =>
  new Response(JSON.stringify(data), { status, headers });
test("vault encrypts access and refresh tokens and rejects wrong key", () => {
  const { vault, file } = make(fetch);
  const disk = readFileSync(file, "utf8");
  assert.ok(!disk.includes(tokens.access_token));
  assert.ok(!disk.includes(tokens.refresh_token));
  assert.deepEqual(vault.load(), tokens);
  assert.throws(() => new Vault(file, randomBytes(32)).load());
  vault.clear();
  assert.equal(vault.load(), undefined);
});
test("offline streams never issue Create Clip", async () => {
  let count = 0;
  const { twitch } = make((async () => {
    count++;
    return response({ data: [] });
  }) as typeof fetch);
  await assert.rejects(() => twitch.createClip("123"), /offline/);
  assert.equal(count, 1);
});
test("a clip is not saved until Get Clips confirms it", async () => {
  const paths: string[] = [];
  const { twitch } = make((async (url: any) => {
    paths.push(String(url));
    if (String(url).includes("streams?")) return response({ data: [{}] });
    if (String(url).includes("broadcaster_id="))
      return response({ data: [{ id: "clip123" }] }, 202);
    if (paths.length < 4) return response({ data: [] });
    return response({
      data: [
        {
          url: "https://clips.twitch.tv/clip123",
          duration: 30,
          thumbnail_url: "https://static-cdn.jtvnw.net/test.jpg",
        },
      ],
    });
  }) as typeof fetch);
  const clip = await twitch.createClip("123");
  assert.equal(clip.clipId, "clip123");
  assert.equal(paths.length, 4);
});
test("rate limit prevents repeated API calls until reset", async () => {
  let calls = 0;
  const { twitch } = make((async () => {
    calls++;
    return response({}, 429, {
      "Ratelimit-Reset": String(Math.floor(Date.now() / 1000) + 60),
    });
  }) as typeof fetch);
  await assert.rejects(() => twitch.api("streams"), /rate limit/);
  await assert.rejects(() => twitch.api("streams"), /rate limit/);
  assert.equal(calls, 1);
});
test("concurrent unauthorized requests share one token refresh", async () => {
  let refreshes = 0;
  const { twitch } = make((async (url: any, options: any) => {
    if (String(url).includes("/oauth2/token")) {
      refreshes++;
      await new Promise((r) => setTimeout(r, 10));
      return response({
        access_token: "new-access",
        refresh_token: "new-refresh",
      });
    }
    if (options.headers.Authorization === "Bearer test-access")
      return response({}, 401);
    return response({ data: [] });
  }) as typeof fetch);
  await Promise.all([twitch.api("users"), twitch.api("streams")]);
  assert.equal(refreshes, 1);
  assert.equal(twitch.tokens?.access_token, "new-access");
});
test("ambiguous Create Clip network failure is not retried", async () => {
  let posts = 0;
  const { twitch } = make((async (_url: any, options: any) => {
    if (options.method === "POST") {
      posts++;
      throw Error("Connection lost");
    }
    return response({ data: [{}] });
  }) as typeof fetch);
  await assert.rejects(() => twitch.createClip("123"), /Connection lost/);
  assert.equal(posts, 1);
});
test("confirmation is bounded and an absent clip is a failure", async () => {
  let calls = 0;
  const { twitch } = make((async (url: any) => {
    calls++;
    return String(url).includes("streams?")
      ? response({ data: [{}] })
      : String(url).includes("broadcaster_id")
        ? response({ data: [{ id: "missing" }] }, 202)
        : response({ data: [] });
  }) as typeof fetch);
  await assert.rejects(() => twitch.createClip("123"), /did not confirm/);
  assert.equal(calls, 17);
});
test("invalid refresh clears credentials", async () => {
  const { twitch, vault } = make((async (url: any) =>
    response(
      {},
      String(url).includes("/oauth2/token") ? 400 : 401,
    )) as typeof fetch);
  await assert.rejects(() => twitch.api("users"));
  assert.equal(twitch.tokens, undefined);
  assert.equal(vault.load(), undefined);
});
