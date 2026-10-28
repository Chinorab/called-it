import { test } from "node:test";
import { request } from "node:http";
import { pathToFileURL } from "node:url";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { resolve, join } from "node:path";
import { once } from "node:events";
import WebSocket from "ws";
test(
  "local API and overlay enforce distinct authorization boundaries",
  { timeout: 20000 },
  async () => {
    mkdirSync("work/tests", { recursive: true });
    const cwd = resolve(mkdtempSync("work/tests/server-"));
    mkdirSync(join(cwd, "dist"));
    writeFileSync(
      join(cwd, "dist/index.html"),
      "<!doctype html><title>Test</title>",
    );
    const port = 45000 + Math.floor(Math.random() * 10000),
      origin = "http://localhost:" + port;
    const child = spawn(
      process.execPath,
      [
        "--import",
        pathToFileURL(resolve("node_modules/tsx/dist/loader.mjs")).href,
        resolve("src/server.ts"),
      ],
      {
        cwd,
        windowsHide: true,
        env: {
          ...process.env,
          PORT: String(port),
          BASE_URL: origin,
          TWITCH_CLIENT_ID: "",
          TWITCH_CLIENT_SECRET: "",
          TOKEN_ENCRYPTION_KEY: "",
        },
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
    let overlay: WebSocket | undefined;
    let diagnostics = "";
    child.stderr!.on("data", (chunk) => {
      diagnostics += chunk.toString();
    });
    try {
      await Promise.race([
        once(child.stdout!, "data"),
        once(child, "exit").then(() => {
          throw Error("Test server exited: " + diagnostics);
        }),
        new Promise((_, reject) =>
          setTimeout(() => reject(Error("Server did not start")), 8000).unref(),
        ),
      ]);
      const root = await fetch(origin);
      assert.equal(root.status, 200);
      const cookie = root.headers.get("set-cookie")!.split(";")[0];
      assert.equal((await fetch(origin + "/api/state")).status, 401);
      assert.equal(
        (
          await fetch(origin + "/api/settings", {
            method: "PUT",
            headers: { Cookie: cookie, "Content-Type": "application/json" },
            body: "{}",
          })
        ).status,
        403,
      );
      assert.equal(
        (
          await fetch(origin + "/api/settings", {
            method: "PUT",
            headers: {
              Cookie: cookie,
              Origin: origin,
              "Content-Type": "application/json",
            },
            body: "{}",
          })
        ).status,
        400,
      );
      assert.equal(
        await new Promise<number | undefined>((resolve, reject) => {
          const req = request(
            origin,
            { headers: { Host: "untrusted.example" } },
            (response) => {
              response.resume();
              resolve(response.statusCode);
            },
          );
          req.on("error", reject);
          req.end();
        }),
        403,
      );
      const state = (await (
        await fetch(origin + "/api/state", { headers: { Cookie: cookie } })
      ).json()) as { overlayUrl: string };
      const key = new URL(state.overlayUrl).hash.slice(1);
      overlay = new WebSocket(
        "ws://localhost:" + port + "/ws?role=overlay&key=" + key,
        { origin },
      );
      const [raw] = await once(overlay, "message");
      const snapshot = JSON.parse(raw.toString()).data;
      assert.equal(snapshot.overlayUrl, undefined);
      assert.ok(!JSON.stringify(snapshot).includes("access_token"));
      assert.equal(
        (
          await fetch(origin + "/api/settings?key=" + key, {
            method: "PUT",
            headers: { Origin: origin, "Content-Type": "application/json" },
            body: "{}",
          })
        ).status,
        401,
      );
      const closed = once(overlay, "close");
      const rotation = await fetch(origin + "/api/overlay/rotate", {
        method: "POST",
        headers: {
          Cookie: cookie,
          Origin: origin,
          "Content-Type": "application/json",
        },
        body: "{}",
      });
      assert.equal(rotation.status, 200);
      assert.equal((await closed)[0], 4001);
      const bad = new WebSocket(
        "ws://localhost:" + port + "/ws?role=overlay&key=" + key,
        { origin },
      );
      const rejected = await new Promise<boolean>((resolve) => {
        bad.on("error", () => resolve(true));
        bad.on("open", () => {
          bad.close();
          resolve(false);
        });
      });
      assert.equal(rejected, true);
    } finally {
      overlay?.terminate();
      if (child.exitCode === null && child.signalCode === null) {
        const exited = once(child, "exit");
        child.kill();
        await exited;
      }
    }
  },
);
