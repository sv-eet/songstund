import { getAuth, getSessionUser, RESERVED_SLUGS } from "./auth.js";
import { handleImport } from "./import.js";
export { SessionRoom } from "./room.js";

const CODE_ALPHABET = "BDFGHJKLMNPRSTV"; // no vowels — avoids real words
const makeCode = () =>
  Array.from({ length: 4 }, () => CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)]).join("");

const json = (data, status = 200) => Response.json(data, { status });
const notFound = () => json({ error: "Fannst ekki." }, 404);
const unauthorized = () => json({ error: "Innskráningar er krafist." }, 401);

async function requireUser(request, env) {
  const user = await getSessionUser(request, env);
  if (!user) throw new Response(JSON.stringify({ error: "Innskráningar er krafist." }), {
    status: 401, headers: { "content-type": "application/json" },
  });
  return user;
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const { pathname } = url;

    try {
      // better-auth handles /api/auth/*
      if (pathname.startsWith("/api/auth/")) {
        return getAuth(env).handler(request);
      }

      if (pathname.startsWith("/api/")) {
        return await handleApi(request, env, url);
      }

      // /{slug} (and legacy /p/{slug}) — vanity redirect to the player's
      // active session. Reserved app routes can never be slugs.
      const vanity = pathname.match(/^\/(?:p\/)?([a-z0-9-]+)\/?$/);
      if (vanity && !RESERVED_SLUGS.has(vanity[1])) {
        const code = await activeSessionCodeForSlug(env, vanity[1]);
        if (code) return Response.redirect(`${url.origin}/s/${code}`, 302);
        // fall through to the SPA, which shows a friendly "no active session" page
      }

      return env.ASSETS.fetch(request);
    } catch (e) {
      if (e instanceof Response) return e;
      console.error(e);
      return json({ error: "Óvænt villa kom upp." }, 500);
    }
  },
};

async function activeSessionCodeForSlug(env, slug) {
  const row = await env.DB.prepare(
    `SELECT s.code FROM sessions s JOIN "user" u ON u.id = s.user_id
     WHERE u.vanity_slug = ? AND s.ended_at IS NULL
     ORDER BY s.created_at DESC LIMIT 1`
  ).bind(slug).first();
  return row?.code ?? null;
}

async function handleApi(request, env, url) {
  const { pathname } = url;
  const method = request.method;
  let m;

  // ── live sync: WebSocket into the session's Durable Object ──
  if ((m = pathname.match(/^\/api\/room\/([A-Za-z]{4})\/ws$/))) {
    const code = m[1].toUpperCase();
    const row = await env.DB.prepare("SELECT user_id, ended_at FROM sessions WHERE code = ?").bind(code).first();
    if (!row) return notFound();

    let role = "guest";
    if (url.searchParams.get("role") === "host") {
      const user = await getSessionUser(request, env);
      if (!user || user.id !== row.user_id) return unauthorized();
      role = "host";
    }
    const headers = new Headers(request.headers);
    headers.set("x-songstund-role", role);
    headers.set("x-songstund-code", code);
    const stub = env.ROOM.get(env.ROOM.idFromName(code));
    return stub.fetch(new Request(request.url, { headers }));
  }

  // ── vanity lookup for the SPA fallback page ──
  if ((m = pathname.match(/^\/api\/p\/([a-z0-9-]+)$/)) && method === "GET") {
    const owner = await env.DB.prepare('SELECT 1 FROM "user" WHERE vanity_slug = ?').bind(m[1]).first();
    const code = owner ? await activeSessionCodeForSlug(env, m[1]) : null;
    return json({ exists: !!owner, code });
  }

  // Everything below requires a signed-in player.
  const user = await requireUser(request, env);

  if (pathname === "/api/me" && method === "GET") {
    return json({ user: publicUser(user) });
  }

  // change your vanity slug (songstund.samskiptalausnir.is/{slug})
  if (pathname === "/api/me" && method === "PATCH") {
    const body = await request.json().catch(() => ({}));
    const slug = String(body.vanity_slug ?? "").toLowerCase().trim();
    if (!/^[a-z0-9-]{3,40}$/.test(slug))
      return json({ error: "Slóðin má aðeins innihalda a–z, 0–9 og bandstrik (3–40 stafir)." }, 400);
    if (RESERVED_SLUGS.has(slug))
      return json({ error: "Þessi slóð er frátekin." }, 400);
    const taken = await env.DB.prepare('SELECT 1 FROM "user" WHERE vanity_slug = ? AND id != ?')
      .bind(slug, user.id).first();
    if (taken) return json({ error: "Þessi slóð er þegar í notkun." }, 409);
    await env.DB.prepare('UPDATE "user" SET vanity_slug = ? WHERE id = ?').bind(slug, user.id).run();
    return json({ user: { ...publicUser(user), vanity_slug: slug } });
  }

  // New registrations wait for admin approval before the player area unlocks.
  if (!user.approved && !user.is_admin && !pathname.startsWith("/api/admin/")) {
    return json({ error: "Aðgangurinn þinn bíður samþykkis." }, 403);
  }

  // ── songbooks ──
  if (pathname === "/api/songbooks" && method === "GET") {
    let { results } = await env.DB.prepare(
      "SELECT id, name, created_at FROM songbooks WHERE user_id = ? ORDER BY created_at"
    ).bind(user.id).all();
    if (!results.length) {
      const id = crypto.randomUUID();
      await env.DB.prepare("INSERT INTO songbooks (id, user_id, name) VALUES (?,?,?)")
        .bind(id, user.id, "Söngbókin mín").run();
      results = [{ id, name: "Söngbókin mín", created_at: new Date().toISOString() }];
    }
    return json({ songbooks: results });
  }
  if (pathname === "/api/songbooks" && method === "POST") {
    const { name } = await request.json().catch(() => ({}));
    if (!name?.trim()) return json({ error: "Vantar nafn á söngbók." }, 400);
    const id = crypto.randomUUID();
    await env.DB.prepare("INSERT INTO songbooks (id, user_id, name) VALUES (?,?,?)")
      .bind(id, user.id, name.trim().slice(0, 80)).run();
    return json({ songbook: { id, name: name.trim().slice(0, 80) } });
  }
  if ((m = pathname.match(/^\/api\/songbooks\/([\w-]+)$/))) {
    const book = await env.DB.prepare("SELECT id FROM songbooks WHERE id = ? AND user_id = ?")
      .bind(m[1], user.id).first();
    if (!book) return notFound();
    if (method === "PATCH") {
      const { name } = await request.json().catch(() => ({}));
      if (!name?.trim()) return json({ error: "Vantar nafn." }, 400);
      await env.DB.prepare("UPDATE songbooks SET name = ? WHERE id = ?")
        .bind(name.trim().slice(0, 80), m[1]).run();
      return json({ ok: true });
    }
    if (method === "DELETE") {
      await env.DB.prepare("DELETE FROM songbooks WHERE id = ?").bind(m[1]).run();
      return json({ ok: true });
    }
  }
  // songs in a songbook (through the join table)
  if ((m = pathname.match(/^\/api\/songbooks\/([\w-]+)\/songs$/)) && method === "GET") {
    const book = await env.DB.prepare("SELECT id FROM songbooks WHERE id = ? AND user_id = ?")
      .bind(m[1], user.id).first();
    if (!book) return notFound();
    const { results } = await env.DB.prepare(
      `SELECT s.id, s.title, s.author, s.key, s.source, s.lines_json FROM songs s
       JOIN songbook_songs bs ON bs.song_id = s.id
       WHERE bs.songbook_id = ? ORDER BY bs.position, bs.added_at`
    ).bind(m[1]).all();
    return json({ songs: results.map((s) => ({ ...s, lines: JSON.parse(s.lines_json), lines_json: undefined })) });
  }
  // add a library song to a songbook
  if ((m = pathname.match(/^\/api\/songbooks\/([\w-]+)\/songs$/)) && method === "POST") {
    const { songId } = await request.json().catch(() => ({}));
    const book = await env.DB.prepare("SELECT id FROM songbooks WHERE id = ? AND user_id = ?")
      .bind(m[1], user.id).first();
    const song = await env.DB.prepare("SELECT id FROM songs WHERE id = ? AND user_id = ?")
      .bind(songId ?? "", user.id).first();
    if (!book || !song) return notFound();
    await env.DB.prepare("INSERT OR IGNORE INTO songbook_songs (songbook_id, song_id) VALUES (?,?)")
      .bind(m[1], songId).run();
    return json({ ok: true });
  }
  // remove a song from a songbook (it stays in the library)
  if ((m = pathname.match(/^\/api\/songbooks\/([\w-]+)\/songs\/([\w-]+)$/)) && method === "DELETE") {
    const book = await env.DB.prepare("SELECT id FROM songbooks WHERE id = ? AND user_id = ?")
      .bind(m[1], user.id).first();
    if (!book) return notFound();
    const res = await env.DB.prepare("DELETE FROM songbook_songs WHERE songbook_id = ? AND song_id = ?")
      .bind(m[1], m[2]).run();
    return res.meta.changes ? json({ ok: true }) : notFound();
  }

  // ── song library ──
  if (pathname === "/api/songs" && method === "GET") {
    const { results } = await env.DB.prepare(
      `SELECT s.id, s.title, s.author, s.key, s.source, s.created_at,
              (SELECT COUNT(*) FROM songbook_songs bs WHERE bs.song_id = s.id) AS in_books
       FROM songs s WHERE s.user_id = ? ORDER BY s.title COLLATE NOCASE`
    ).bind(user.id).all();
    return json({ songs: results });
  }
  // delete a song from the library entirely (leaves every songbook via cascade)
  if ((m = pathname.match(/^\/api\/songs\/([\w-]+)$/)) && method === "DELETE") {
    const res = await env.DB.prepare("DELETE FROM songs WHERE id = ? AND user_id = ?")
      .bind(m[1], user.id).run();
    return res.meta.changes ? json({ ok: true }) : notFound();
  }

  // ── import ──
  if (pathname === "/api/import" && method === "POST") {
    return handleImport(request, env, user);
  }

  // ── sessions ──
  if (pathname === "/api/sessions" && method === "POST") {
    // End any previous active session for this user (one live session per player).
    await env.DB.prepare("UPDATE sessions SET ended_at = datetime('now') WHERE user_id = ? AND ended_at IS NULL")
      .bind(user.id).run();
    let code;
    for (let i = 0; i < 8; i++) {
      code = makeCode();
      const hit = await env.DB.prepare("SELECT 1 FROM sessions WHERE code = ?").bind(code).first();
      if (!hit) break;
      code = null;
    }
    if (!code) return json({ error: "Gat ekki búið til kóða — reyndu aftur." }, 500);
    await env.DB.prepare("INSERT INTO sessions (code, user_id) VALUES (?,?)").bind(code, user.id).run();
    return json({ code, vanity_slug: user.vanity_slug ?? null });
  }
  if ((m = pathname.match(/^\/api\/sessions\/([A-Za-z]{4})$/)) && method === "DELETE") {
    const code = m[1].toUpperCase();
    const res = await env.DB.prepare(
      "UPDATE sessions SET ended_at = datetime('now') WHERE code = ? AND user_id = ? AND ended_at IS NULL"
    ).bind(code, user.id).run();
    return res.meta.changes ? json({ ok: true }) : notFound();
  }

  // ── admin (read-only tables + import log) ──
  if (pathname.startsWith("/api/admin/")) {
    if (!user.is_admin) return json({ error: "Aðgangur bannaður." }, 403);
    if (pathname === "/api/admin/users" && method === "GET") {
      const { results } = await env.DB.prepare(
        `SELECT u.email, u.subscription_status, u.vanity_slug, u.approved, u.is_admin, u."createdAt" as created_at,
                (SELECT COUNT(*) FROM songs sg WHERE sg.user_id = u.id) AS songs,
                (SELECT COUNT(*) FROM sessions se WHERE se.user_id = u.id) AS sessions
         FROM "user" u ORDER BY u.approved ASC, u."createdAt" DESC LIMIT 200`
      ).all();
      return json({ users: results });
    }
    if (pathname === "/api/admin/users/approval" && method === "POST") {
      const { email, approved } = await request.json().catch(() => ({}));
      if (typeof email !== "string" || typeof approved !== "boolean")
        return json({ error: "Vantar email og approved." }, 400);
      const res = await env.DB.prepare('UPDATE "user" SET approved = ? WHERE email = ?')
        .bind(approved ? 1 : 0, email).run();
      return res.meta.changes ? json({ ok: true }) : notFound();
    }
    if (pathname === "/api/admin/sessions" && method === "GET") {
      const { results } = await env.DB.prepare(
        `SELECT s.code, s.created_at, s.ended_at, u.email FROM sessions s
         JOIN "user" u ON u.id = s.user_id ORDER BY s.created_at DESC LIMIT 100`
      ).all();
      return json({ sessions: results });
    }
    if (pathname === "/api/admin/import-log" && method === "GET") {
      const { results } = await env.DB.prepare(
        `SELECT l.created_at, l.kind, l.source, l.ok, l.message, u.email FROM import_log l
         LEFT JOIN "user" u ON u.id = l.user_id ORDER BY l.id DESC LIMIT 100`
      ).all();
      return json({ log: results });
    }
  }

  return notFound();
}

function publicUser(u) {
  return {
    id: u.id, email: u.email, name: u.name,
    subscription_status: u.subscription_status,
    vanity_slug: u.vanity_slug ?? null,
    is_admin: !!u.is_admin,
    approved: !!u.approved,
  };
}
