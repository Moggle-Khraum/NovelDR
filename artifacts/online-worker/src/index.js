import { DurableObject } from "cloudflare:workers";

const STALE_MS = 90_000; // no ping for this long = treated as gone
const POST_GAP_MS = 300_000; // at most one log line per 5 minutes
const TICK_MS = 60_000;

export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    if (url.pathname === "/ws" && req.headers.get("Upgrade") === "websocket") {
      return env.COUNTER.get(env.COUNTER.idFromName("main")).fetch(req);
    }
    return new Response("not found", { status: 404 });
  },
};

export class Counter extends DurableObject {
  posting = false;

  async fetch() {
    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);
    this.ctx.acceptWebSocket(server);
    server.serializeAttachment({ t: Date.now() });
    await this.tick(false);
    return new Response(null, { status: 101, webSocket: client });
  }

  async webSocketMessage(ws, msg) {
    try {
      ws.serializeAttachment({ t: Date.now() });
      if (msg === "ping") ws.send("pong");
    } catch {}
    await this.tick(false);
  }

  async webSocketClose(ws, code) {
    try {
      ws.serializeAttachment({ t: 0 });
      ws.close(code, "bye");
    } catch {}
    await this.tick(false);
  }

  async webSocketError(ws) {
    try {
      ws.serializeAttachment({ t: 0 });
    } catch {}
    await this.tick(false);
  }

  async alarm() {
    await this.tick(true);
  }

  online() {
    const now = Date.now();
    return this.ctx
      .getWebSockets()
      .filter((ws) => {
        const a = ws.deserializeAttachment();
        return a && now - a.t < STALE_MS;
      }).length;
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
    let line = `[${stamp} PHT] Online: ${count}`;
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
