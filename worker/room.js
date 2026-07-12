import { DurableObject } from "cloudflare:workers";

/* One SessionRoom per 4-letter session code. The host pushes state
   (select_song / set_line / end); every connected guest gets the full
   state on connect and on every change. Guests can send song requests,
   which queue in storage and go to the host. Presence (guest count) is
   broadcast on join/leave and the peak is persisted to D1 for history.
   Uses the WebSocket hibernation API so idle rooms cost nothing. */

const MAX_REQUESTS = 50;
const REQUEST_MIN_GAP_MS = 8000;

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
    const headerRole = request.headers.get("x-songstund-role");
    const role = headerRole === "host" ? "host" : headerRole === "cohost" ? "cohost" : "guest";
    const code = request.headers.get("x-songstund-code") || "";
    await this.ctx.storage.put("code", code);

    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);
    this.ctx.acceptWebSocket(server, [role]);
    server.serializeAttachment({ role, code, lastRequestAt: 0 });

    server.send(JSON.stringify({ type: "role", role }));
    const state = await this.ctx.storage.get("state");
    server.send(JSON.stringify({ type: "state", state: state ?? { code, songId: null, line: 0, song: null, updatedAt: Date.now() } }));
    if (role === "host" || role === "cohost") {
      const requests = (await this.ctx.storage.get("requests")) ?? [];
      server.send(JSON.stringify({ type: "requests", requests }));
      const next = await this.ctx.storage.get("next");
      server.send(JSON.stringify({ type: "next", next: next ? { songId: next.songId, title: next.title, author: next.author } : null }));
      const songlist = (await this.ctx.storage.get("songlist")) ?? [];
      server.send(JSON.stringify({ type: "songlist", songs: songlist }));
    }
    await this.broadcastPresence(code);

    return new Response(null, { status: 101, webSocket: client });
  }

  async webSocketMessage(ws, message) {
    const attachment = ws.deserializeAttachment() ?? {};
    const { role, code } = attachment;
    if (typeof message !== "string") return;
    let msg;
    try { msg = JSON.parse(message); } catch { return; }

    if (role === "guest") {
      if (msg.type !== "request") return;
      const now = Date.now();
      if (now - (attachment.lastRequestAt ?? 0) < REQUEST_MIN_GAP_MS) {
        try { ws.send(JSON.stringify({ type: "request_err", message: "Aðeins rólegri — reyndu aftur eftir smástund." })); } catch {}
        return;
      }
      const text = String(msg.text ?? "").trim().slice(0, 200);
      if (!text) return;
      ws.serializeAttachment({ ...attachment, lastRequestAt: now });
      const requests = ((await this.ctx.storage.get("requests")) ?? []).slice(-MAX_REQUESTS + 1);
      requests.push({ id: crypto.randomUUID(), text, at: now });
      await this.ctx.storage.put("requests", requests);
      this.sendToControllers(JSON.stringify({ type: "requests", requests }));
      try { ws.send(JSON.stringify({ type: "request_ok" })); } catch {}
      return;
    }

    // ── host + cohost messages ──
    const prev = (await this.ctx.storage.get("state")) ?? { code, songId: null, line: 0, song: null };
    let state = null;

    if (msg.type === "set_line" && Number.isInteger(msg.line) && role === "cohost") {
      state = { ...prev, code, line: msg.line, updatedAt: Date.now() };
      await this.ctx.storage.put("state", state);
      this.broadcast(JSON.stringify({ type: "state", state }));
      return;
    }
    if (msg.type === "queue_song" && msg.songId) {
      // Look the song up in D1 and verify it belongs to the session owner.
      const row = await this.env.DB.prepare(
        `SELECT s.id, s.title, s.author, s.lines_json FROM songs s
         JOIN sessions se ON se.user_id = s.user_id
         WHERE s.id = ? AND se.code = ?`
      ).bind(String(msg.songId), code).first();
      if (!row) return;
      const next = { songId: row.id, title: row.title, author: row.author, lines: JSON.parse(row.lines_json) };
      await this.ctx.storage.put("next", next);
      this.sendToControllers(JSON.stringify({ type: "next", next: { songId: next.songId, title: next.title, author: next.author } }));
      return;
    }
    if (msg.type === "request_done" && msg.id) {
      const requests = ((await this.ctx.storage.get("requests")) ?? []).filter((r) => r.id !== msg.id);
      await this.ctx.storage.put("requests", requests);
      this.sendToControllers(JSON.stringify({ type: "requests", requests }));
      return;
    }
    if (msg.type === "play_next") {
      const next = await this.ctx.storage.get("next");
      if (!next) return;
      const state2 = { code, songId: next.songId, line: 0, song: { title: next.title, author: next.author, lines: next.lines }, updatedAt: Date.now() };
      await this.ctx.storage.put("state", state2);
      await this.ctx.storage.delete("next");
      this.broadcast(JSON.stringify({ type: "state", state: state2 }));
      this.sendToControllers(JSON.stringify({ type: "next", next: null }));
      return;
    }
    if (role !== "host") return; // everything below is host-only

    if (msg.type === "set_songlist" && Array.isArray(msg.songs)) {
      const songs = msg.songs.slice(0, 300).map((s) => ({
        id: String(s.id), title: String(s.title ?? ""), author: String(s.author ?? ""),
      }));
      await this.ctx.storage.put("songlist", songs);
      this.sendToControllers(JSON.stringify({ type: "songlist", songs }));
      return;
    }

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

  async webSocketClose(ws) {
    try { ws.close(); } catch {}
    const code = (await this.ctx.storage.get("code")) ?? "";
    await this.broadcastPresence(code);
  }
  async webSocketError(ws) { try { ws.close(); } catch {} }

  broadcast(payload) {
    for (const s of this.ctx.getWebSockets()) {
      try { s.send(payload); } catch {}
    }
  }

  sendToHosts(payload) {
    for (const s of this.ctx.getWebSockets("host")) {
      try { s.send(payload); } catch {}
    }
  }

  // Hosts and cohosts — everyone with controls.
  sendToControllers(payload) {
    for (const tag of ["host", "cohost"]) {
      for (const s of this.ctx.getWebSockets(tag)) {
        try { s.send(payload); } catch {}
      }
    }
  }

  async broadcastPresence(code) {
    const guests = this.ctx.getWebSockets("guest").length;
    this.broadcast(JSON.stringify({ type: "presence", guests }));
    // Persist the peak for the session history.
    const peak = (await this.ctx.storage.get("peak")) ?? 0;
    if (guests > peak && code) {
      await this.ctx.storage.put("peak", guests);
      try {
        await this.env.DB.prepare("UPDATE sessions SET peak_guests = ? WHERE code = ?")
          .bind(guests, code).run();
      } catch { /* history is best-effort */ }
    }
  }
}
