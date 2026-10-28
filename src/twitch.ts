import { Vault, type Tokens } from "./storage.js";
export const SCOPES = ["user:read:chat", "clips:edit"];
export class TwitchError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
export class Twitch {
  tokens?: Tokens;
  private refreshInFlight?: Promise<void>;
  private blockedUntil = 0;
  onInvalid = () => {};
  constructor(
    public clientId: string,
    private secret: string,
    private redirect: string,
    private vault: Vault,
    private request: typeof fetch = fetch,
    private wait = sleep,
  ) {
    this.tokens = vault.load();
  }
  private async tokenRequest(params: Record<string, string>) {
    const r = await this.request("https://id.twitch.tv/oauth2/token", {
      method: "POST",
      body: new URLSearchParams({
        ...params,
        client_id: this.clientId,
        client_secret: this.secret,
      }),
      signal: AbortSignal.timeout(12000),
    });
    if (!r.ok)
      throw new TwitchError(
        r.status,
        "Twitch authorization failed. Connect again.",
      );
    const t = (await r.json()) as {
      access_token: string;
      refresh_token: string;
    };
    if (!t.access_token || !t.refresh_token)
      throw Error("Twitch returned incomplete credentials");
    return t;
  }
  async exchange(code: string) {
    const t = await this.tokenRequest({
      grant_type: "authorization_code",
      code,
      redirect_uri: this.redirect,
    });
    this.tokens = { ...t, userId: "", login: "" };
    try {
      await this.validate();
      this.vault.save(this.tokens!);
    } catch (e) {
      this.clear();
      throw e;
    }
  }
  clear() {
    this.tokens = undefined;
    this.vault.clear();
    this.onInvalid();
  }
  async refresh() {
    if (!this.refreshInFlight)
      this.refreshInFlight = (async () => {
        const previous = this.tokens;
        if (!previous) throw Error("Connect Twitch first");
        try {
          const t = await this.tokenRequest({
            grant_type: "refresh_token",
            refresh_token: previous.refresh_token,
          });
          if (this.tokens !== previous) throw Error("Authorization changed");
          this.tokens = { ...previous, ...t };
          this.vault.save(this.tokens);
        } catch (e) {
          if (
            e instanceof TwitchError &&
            (e.status === 400 || e.status === 401)
          )
            this.clear();
          throw e;
        }
      })().finally(() => {
        this.refreshInFlight = undefined;
      });
    return this.refreshInFlight;
  }
  async validate() {
    if (!this.tokens) return;
    let r = await this.request("https://id.twitch.tv/oauth2/validate", {
      headers: { Authorization: "OAuth " + this.tokens.access_token },
      signal: AbortSignal.timeout(12000),
    });
    if (r.status === 401) {
      await this.refresh();
      r = await this.request("https://id.twitch.tv/oauth2/validate", {
        headers: { Authorization: "OAuth " + this.tokens!.access_token },
        signal: AbortSignal.timeout(12000),
      });
    }
    if (!r.ok) {
      if (r.status === 401) this.clear();
      throw Error("Twitch token validation failed");
    }
    const v = (await r.json()) as {
      client_id: string;
      user_id: string;
      login: string;
      scopes: string[];
    };
    if (
      v.client_id !== this.clientId ||
      !SCOPES.every((s) => v.scopes.includes(s))
    ) {
      this.clear();
      throw Error("Twitch permissions changed. Connect again.");
    }
    this.tokens = { ...this.tokens!, userId: v.user_id, login: v.login };
    this.vault.save(this.tokens);
  }
  async disconnect() {
    const token = this.tokens?.access_token;
    this.clear();
    if (token) {
      const r = await this.request("https://id.twitch.tv/oauth2/revoke", {
        method: "POST",
        body: new URLSearchParams({ client_id: this.clientId, token }),
        signal: AbortSignal.timeout(12000),
      });
      if (!r.ok)
        throw Error(
          "Local tokens removed. Revoke Called It in Twitch Connections.",
        );
    }
  }
  async api(
    path: string,
    method = "GET",
    body?: unknown,
    retry = true,
  ): Promise<any> {
    if (!this.tokens) throw Error("Connect Twitch first");
    if (Date.now() < this.blockedUntil)
      throw new TwitchError(
        429,
        "Twitch rate limit reached. Wait before the next moment.",
      );
    const token = this.tokens.access_token;
    const r = await this.request("https://api.twitch.tv/helix/" + path, {
      method,
      headers: {
        Authorization: "Bearer " + token,
        "Client-Id": this.clientId,
        "Content-Type": "application/json",
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(12000),
    });
    if (r.headers.get("Ratelimit-Remaining") === "0" || r.status === 429) {
      const reset = Number(r.headers.get("Ratelimit-Reset"));
      this.blockedUntil = Math.max(
        Date.now() + 1000,
        reset ? reset * 1000 : Date.now() + 60000,
      );
    }
    if (r.status === 401 && retry) {
      if (this.tokens?.access_token === token) await this.refresh();
      return this.api(path, method, body, false);
    }
    if (!r.ok) {
      if (r.status === 401) this.clear();
      const message =
        r.status === 404
          ? "The channel is offline"
          : r.status === 403
            ? "Clipping is disabled or restricted on Twitch"
            : r.status === 429
              ? "Twitch rate limit reached. Wait before the next moment."
              : "Twitch request failed (" + r.status + ")";
      throw new TwitchError(r.status, message);
    }
    return r.status === 204 ? {} : r.json();
  }
  async createClip(broadcasterId: string) {
    const stream = await this.api(
      "streams?user_id=" + encodeURIComponent(broadcasterId),
    );
    if (!stream.data?.length)
      throw new TwitchError(404, "The channel is offline");
    const response = await this.api(
      "clips?broadcaster_id=" + encodeURIComponent(broadcasterId),
      "POST",
    );
    const clipId = response.data?.[0]?.id;
    if (!clipId) throw Error("Twitch did not return a clip ID");
    const deadline = Date.now() + 15000;
    for (let attempt = 0; attempt < 15 && Date.now() < deadline; attempt++) {
      await this.wait(1000);
      const clips = await this.api("clips?id=" + encodeURIComponent(clipId));
      const clip = clips.data?.[0];
      if (clip)
        return {
          clipId,
          url: clip.url,
          thumbnail: clip.thumbnail_url,
          duration: clip.duration,
        };
    }
    throw Error("Twitch did not confirm the clip within 15 seconds");
  }
}
