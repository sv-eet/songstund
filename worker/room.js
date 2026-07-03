import { DurableObject } from "cloudflare:workers";

/* One SessionRoom per 4-letter session code. The host pushes state
   (select_song / set_line / end); every connected guest gets the full
   state on connect and on every change. Uses the WebSocket hibernation
   API so idle rooms cost nothing. */

export class SessionRoom extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    // Keep-alive pings from clients are answered without waking the DO.
    this.ctx.setWebSocketAutoResponse(
      new WebSocketRequestResponsePair("ping", "pong")
    );
  }

  async fetch(request) {
    if (request.headers.get("Upgrade") !== "websocket") {
      return new Response("Expected WebSocket", { status: 426 });
    }
    const role = request.headers.get("x-songstund-role") === "host" ? "host" : "guest";
    const code = request.headers.get("x-songstund-code") || "";

    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);
    this.ctx.acceptWebSocket(server, [role]);
    server.serializeAttachment({ role, code });

    const state = await this.ctx.storage.get("state");
    server.send(JSON.stringify({ type: "state", state: state ?? { code, songId: null, line: 0, song: null, updatedAt: Date.now() } }));

    return new Response(null, { status: 101, webSocket: client });
  }

  async webSocketMessage(ws, message) {
    const { role, code } = ws.deserializeAttachment() ?? {};
    if (role !== "host" || typeof message !== "string") return;

    let msg;
    try { msg = JSON.parse(message); } catch { return; }

    const prev = (await this.ctx.storage.get("state")) ?? { code, songId: null, line: 0, song: null };
    let state = null;

    if (msg.type === "select_song" && msg.song) {
      state = { code, songId: msg.songId ?? null, line: 0, song: {
        title: String(msg.song.title ?? ""),
        author: String(msg.song.author ?? ""),
        lines: Array.isArray(msg.song.lines) ? msg.song.lines : [],
      }, updatedAt: Date.now() };
    } else if (msg.type === "set_line" && Number.isInteger(msg.line)) {
      state = { ...prev, code, line: msg.line, updatedAt: Date.now() };
    } else if (msg.type === "clear_song") {
      state = { code, songId: null, line: 0, song: null, updatedAt: Date.now() };
    } else if (msg.type === "end") {
      await this.ctx.storage.deleteAll();
      this.broadcast(JSON.stringify({ type: "ended" }));
      for (const s of this.ctx.getWebSockets()) { try { s.close(1000, "ended"); } catch {} }
      return;
    }

    if (state) {
      await this.ctx.storage.put("state", state);
      this.broadcast(JSON.stringify({ type: "state", state }));
    }
  }

  async webSocketClose(ws) { try { ws.close(); } catch {} }
  async webSocketError(ws) { try { ws.close(); } catch {} }

  broadcast(payload) {
    for (const s of this.ctx.getWebSockets()) {
      try { s.send(payload); } catch {}
    }
  }
}
