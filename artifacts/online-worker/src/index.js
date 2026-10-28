import { DurableObject } from "cloudflare:workers";

const STALE_MS = 60_000; // no ping for this long = treated as gone
const POST_GAP_MS = 180_000; // at most one log line per 5 minutes
const TICK_MS = 60_000;

export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    if (url.pathname === "/ws" && req.headers.get("Upgrade") === "websocket") {
      const headers = new Headers(req.headers);
      headers.set("x-country", req.cf?.country || "");
      return env.COUNTER.get(env.COUNTER.idFromName("main")).fetch(
        new Request(req.url, { headers })
      );
    }
    return new Response("not found", { status: 404 });
  },
};

// Two-letter country code -> flag emoji (regional indicator pair). Unknown -> globe.
function flag(cc) {
  if (!/^[A-Z]{2}$/.test(cc || "")) return "🌐";
  return String.fromCodePoint(
    ...[...cc].map((c) => 0x1f1e6 + c.charCodeAt(0) - 65)
  );
}

export class Counter extends DurableObject {
  posting = false;

  async fetch(req) {
    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);
    this.ctx.acceptWebSocket(server);
    const country = req.headers.get("x-country") || "";
    server.serializeAttachment({ t: Date.now(), c: country });
    await this.tick(false);
    return new Response(null, { status: 101, webSocket: client });
  }

  async webSocketMessage(ws, msg) {
    try {
      const a = ws.deserializeAttachment() || {};
      ws.serializeAttachment({ ...a, t: Date.now() });
      if (msg === "ping") ws.send("pong");
    } catch {}
    await this.tick(false);
  }

  async webSocketClose(ws, code) {
    try {
      const a = ws.deserializeAttachment() || {};
      ws.serializeAttachment({ ...a, t: 0 });
      ws.close(code, "bye");
    } catch {}
    await this.tick(false);
  }

  async webSocketError(ws) {
    try {
      const a = ws.deserializeAttachment() || {};
      ws.serializeAttachment({ ...a, t: 0 });
    } catch {}
    await this.tick(false);
  }

  async alarm() {
    await this.tick(true);
  }

  liveCountries() {
    const now = Date.now();
    return this.ctx
      .getWebSockets()
      .map((ws) => ws.deserializeAttachment())
      .filter((a) => a && now - a.t < STALE_MS)
      .map((a) => a.c || "");
  }

  online() {
    return this.liveCountries().length;
  }

  async tick(fromAlarm) {
    if (this.posting) return;
    const now = Date.now();
    const count = this.online();
    let last = await this.ctx.storage.get("last"); // {count, at}

    if (count !== (last ? last.count : 0) || (!last && count > 0)) {
      if (!last || now - last.at >= POST_GAP_MS) {
        this.posting = true;
        try {
          if (await this.post(count, last, now)) {
            last = { count, at: now };
            await this.ctx.storage.put("last", last);
          }
        } finally {
          this.posting = false;
        }
      }
    }

    const pending = count !== (last ? last.count : 0);
    if (count > 0 || pending) {
      if (fromAlarm || (await this.ctx.storage.getAlarm()) === null) {
        await this.ctx.storage.setAlarm(Date.now() + TICK_MS);
      }
    }
  }

  async post(count, last, now) {
    const stamp = new Date(now + 8 * 3600 * 1000)
      .toISOString()
      .slice(0, 16)
      .replace("T", " ");
    const counts = {};
    for (const cc of this.liveCountries()) counts[cc] = (counts[cc] || 0) + 1;
    const flags = Object.entries(counts)
      .map(([cc, n]) => flag(cc) + (n > 1 ? `×${n}` : ""))
      .join(" ");
    let line = `[${stamp} PHT] Online: ${count}${flags ? " " + flags : ""}`;
    if (last && count > 0) {
      const d = count - last.count;
      line += ` (${d > 0 ? "+" : ""}${d})`;
    }
    try {
      const res = await fetch(this.env.DISCORD_WEBHOOK_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: line, allowed_mentions: { parse: [] } }),
      });
      return res.ok;
    } catch {
      return false;
    }
  }
}
