import {
  mkdirSync,
  readFileSync,
  writeFileSync,
  renameSync,
  existsSync,
  unlinkSync,
} from "node:fs";
import { join } from "node:path";
import { randomBytes, createCipheriv, createDecipheriv } from "node:crypto";
import {
  defaults,
  settingsSchema,
  type Session,
  type Settings,
} from "./model.js";
export function atomicWrite(path: string, data: string) {
  writeFileSync(path + ".tmp", data, { mode: 0o600 });
  renameSync(path + ".tmp", path);
}
export class Store {
  settings: Settings = { ...defaults };
  sessions: Session[] = [];
  overlayKey: string;
  constructor(public directory: string) {
    mkdirSync(directory, { recursive: true, mode: 0o700 });
    const path = join(directory, "state.json");
    if (existsSync(path)) {
      const data = JSON.parse(readFileSync(path, "utf8"));
      this.settings = settingsSchema.parse(data.settings);
      this.sessions = data.sessions;
    }
    for (const session of this.sessions)
      for (const moment of session.moments)
        if (moment.status === "pending") {
          moment.status = "failed";
          moment.error = "App restarted before clip confirmation";
        }
    const keyPath = join(directory, "overlay.key");
    this.overlayKey = existsSync(keyPath)
      ? readFileSync(keyPath, "utf8")
      : randomBytes(32).toString("hex");
    if (!existsSync(keyPath)) atomicWrite(keyPath, this.overlayKey);
  }
  save() {
    atomicWrite(
      join(this.directory, "state.json"),
      JSON.stringify({ settings: this.settings, sessions: this.sessions }),
    );
  }
  rotateOverlay() {
    this.overlayKey = randomBytes(32).toString("hex");
    atomicWrite(join(this.directory, "overlay.key"), this.overlayKey);
  }
}
export type Tokens = {
  access_token: string;
  refresh_token: string;
  userId: string;
  login: string;
};
export class Vault {
  constructor(
    private file: string,
    private key: Buffer,
  ) {
    if (key.length !== 32)
      throw Error("TOKEN_ENCRYPTION_KEY must decode to 32 bytes");
  }
  save(tokens: Tokens) {
    const iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", this.key, iv);
    const bytes = Buffer.concat([
      cipher.update(JSON.stringify(tokens), "utf8"),
      cipher.final(),
    ]);
    atomicWrite(
      this.file,
      JSON.stringify({
        iv: iv.toString("base64"),
        tag: cipher.getAuthTag().toString("base64"),
        data: bytes.toString("base64"),
      }),
    );
  }
  load(): Tokens | undefined {
    if (!existsSync(this.file)) return;
    const v = JSON.parse(readFileSync(this.file, "utf8"));
    const decipher = createDecipheriv(
      "aes-256-gcm",
      this.key,
      Buffer.from(v.iv, "base64"),
    );
    decipher.setAuthTag(Buffer.from(v.tag, "base64"));
    return JSON.parse(
      Buffer.concat([
        decipher.update(Buffer.from(v.data, "base64")),
        decipher.final(),
      ]).toString("utf8"),
    );
  }
  clear() {
    if (existsSync(this.file)) unlinkSync(this.file);
  }
}
