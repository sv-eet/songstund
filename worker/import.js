import { parseSheet, countChordLines, isChordLine } from "./parser.js";

/* POST /api/import — accepts { url } | { pdfText } | { pasted }
   plus { songbookId, title?, author? }. All paths converge on parseSheet.
   Every attempt is logged to import_log for /admin. */

const ENTITIES = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", "#39": "'", "#34": '"' };

function decodeEntities(s) {
  return s
    .replace(/&(#?\w+);/g, (m, e) => {
      if (ENTITIES[e] !== undefined) return ENTITIES[e];
      if (e.startsWith("#x") || e.startsWith("#X")) return String.fromCodePoint(parseInt(e.slice(2), 16));
      if (e.startsWith("#")) return String.fromCodePoint(parseInt(e.slice(1), 10));
      return m;
    });
}

function htmlToText(html) {
  return decodeEntities(
    html
      .replace(/<script[\s\S]*?<\/script>/gi, "")
      .replace(/<style[\s\S]*?<\/style>/gi, "")
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<\/(p|div|li|tr|h[1-6]|pre)>/gi, "\n")
      .replace(/<[^>]+>/g, "")
  );
}

/* Pull the chord/lyric block out of a fetched page: prefer <pre> blocks
   that contain chord lines; otherwise fall back to the chordiest
   contiguous region of the whole page text. */
export function extractSheetFromHtml(html) {
  const pres = [...html.matchAll(/<pre[^>]*>([\s\S]*?)<\/pre>/gi)].map((m) => htmlToText(m[1]));
  let best = null, bestScore = 0;
  for (const p of pres) {
    const score = p.split("\n").filter(isChordLine).length;
    if (score > bestScore) { best = p; bestScore = score; }
  }
  if (best && bestScore >= 2) return best;

  const text = htmlToText(html);
  const lines = text.split("\n").map((l) => l.replace(/\s+$/, ""));
  const chordIdx = lines.map((l, i) => (isChordLine(l) ? i : -1)).filter((i) => i >= 0);
  if (chordIdx.length < 2) return null;
  const start = Math.max(0, chordIdx[0]);
  const end = Math.min(lines.length, chordIdx[chordIdx.length - 1] + 2);
  return lines.slice(start, end).join("\n");
}

export function extractTitleFromHtml(html) {
  const og = html.match(/<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']/i);
  if (og) return decodeEntities(og[1]).trim();
  const t = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  if (t) return decodeEntities(t[1]).split(/[|·—-]/)[0].trim();
  return "";
}

/* Convert ChordPro-style inline brackets — "[G]Núna ertu hjá mér, [C]Nína" —
   into the chord-over-lyric line pairs the rest of the app uses. */
export function bracketedToLines(text) {
  const out = [];
  for (const raw of String(text).replace(/\r/g, "").split("\n")) {
    if (!raw.trim()) { out.push({ c: "", t: "" }); continue; }
    let plain = "";
    const chords = []; // [position in plain text, chord name]
    const re = /\[([^\]]*)\]/g;
    let m, last = 0;
    while ((m = re.exec(raw))) {
      plain += raw.slice(last, m.index);
      if (m[1].trim()) chords.push([plain.length, m[1].trim()]);
      last = m.index + m[0].length;
    }
    plain += raw.slice(last);
    if (!chords.length) { out.push({ c: "", t: plain.trimEnd() }); continue; }
    let c = "";
    for (const [pos, name] of chords) {
      const at = Math.max(pos, c.length ? c.length + 1 : 0);
      c += " ".repeat(at - c.length) + name;
    }
    out.push({ c: c.trimEnd(), t: plain.trimEnd() });
  }
  while (out.length && !out[out.length - 1].t && !out[out.length - 1].c) out.pop();
  return out;
}

const GP_UA = { "User-Agent": "Mozilla/5.0 (compatible; SongstundBot/1.0; +https://songstund.samskiptalausnir.is)" };

/* guitarparty.com song pages are empty shells filled client-side; the song
   lives at /api/v3/core/songs/{id}/ in bracket format. */
async function importFromGuitarparty(url) {
  const pageRes = await fetch(url, { headers: GP_UA, redirect: "follow" });
  if (!pageRes.ok) return { error: `Gat ekki sótt síðuna (HTTP ${pageRes.status}).` };
  const html = await pageRes.text();
  const id = html.match(/data-songcontainer[^>]*data-id="(\d+)"/)?.[1]
    ?? html.match(/data-id="(\d+)"[^>]*data-songcontainer/)?.[1];
  if (!id) return { error: "Fann ekki lagið á síðunni — er slóðin á lagasíðu?" };
  const apiRes = await fetch(`https://www.guitarparty.com/api/v3/core/songs/${id}/`, { headers: GP_UA });
  if (!apiRes.ok) return { error: "Gat ekki sótt lagið frá Guitarparty — það gæti verið læst innskráningu." };
  const data = await apiRes.json();
  if (!data.song) return { error: "Lagið er ekki aðgengilegt án innskráningar á Guitarparty." };
  const lines = bracketedToLines(data.song);
  if (!lines.length) return { error: "Lagið reyndist tómt." };
  const author = [...new Set((data.authors ?? []).map((a) => a?.author?.name).filter(Boolean))].join(" · ");
  return { title: data.title ?? "", author, key: data.key ?? "", lines };
}

export async function handleImport(request, env, user) {
  const body = await request.json().catch(() => ({}));
  const { songbookId } = body;

  const log = async (kind, source, ok, message, lines = []) => {
    await env.DB.prepare(
      "INSERT INTO import_log (user_id, kind, source, ok, message, line_count, chord_lines) VALUES (?,?,?,?,?,?,?)"
    ).bind(user.id, kind, source ?? "", ok ? 1 : 0, message, lines.length, countChordLines(lines)).run();
  };

  const fail = async (kind, source, message, status = 422) => {
    await log(kind, source, false, message);
    return Response.json({ error: message }, { status });
  };

  // Verify songbook ownership
  const book = await env.DB.prepare("SELECT id FROM songbooks WHERE id = ? AND user_id = ?")
    .bind(songbookId ?? "", user.id).first();
  if (!book) return Response.json({ error: "Söngbók fannst ekki." }, { status: 404 });

  /* Songs live in the user's library; a matching title+author is reused
     instead of duplicated, and the song is linked into the songbook. */
  const insertSong = async (title, author, key, source, lines) => {
    const songTitle = (title || "").trim() || "Ónefnt lag";
    const songAuthor = (author || "").trim();
    const existing = await env.DB.prepare(
      "SELECT id, title, author, key, source, lines_json FROM songs WHERE user_id = ? AND title = ? COLLATE NOCASE AND author = ? COLLATE NOCASE"
    ).bind(user.id, songTitle, songAuthor).first();

    let song;
    if (existing) {
      song = { id: existing.id, title: existing.title, author: existing.author, key: existing.key, source: existing.source, lines: JSON.parse(existing.lines_json) };
    } else {
      const id = crypto.randomUUID();
      await env.DB.prepare(
        "INSERT INTO songs (id, user_id, title, author, key, source, lines_json) VALUES (?,?,?,?,?,?,?)"
      ).bind(id, user.id, songTitle, songAuthor, key || "", source, JSON.stringify(lines)).run();
      song = { id, title: songTitle, author: songAuthor, key: key || "", source, lines };
    }
    await env.DB.prepare(
      `INSERT OR IGNORE INTO songbook_songs (songbook_id, song_id, position)
       VALUES (?,?, (SELECT COALESCE(MAX(position) + 1, 0) FROM songbook_songs WHERE songbook_id = ?))`
    ).bind(songbookId, song.id, songbookId).run();
    return song;
  };

  let kind, source, sheetText, songKey = body.key ?? "", title = (body.title ?? "").trim(), author = (body.author ?? "").trim();

  // Multi-song PDF (songbook export): the client splits the document into
  // songs; every sheet goes through the same parser here.
  if (Array.isArray(body.pdfSongs)) {
    kind = "pdf"; source = (body.filename ?? "PDF").slice(0, 200);
    const inserted = [];
    let totalLines = 0, totalChords = 0;
    for (const s of body.pdfSongs.slice(0, 200)) {
      const lines = parseSheet(String(s?.sheet ?? ""));
      if (!lines.length) continue;
      totalLines += lines.length;
      totalChords += countChordLines(lines);
      inserted.push(await insertSong(s.title, s.author, "", source, lines));
    }
    if (!inserted.length)
      return fail(kind, source, "PDF-skjalið inniheldur engan lesanlegan texta — líklega skönnuð mynd. OCR kemur í næstu útgáfu.");
    await env.DB.prepare(
      "INSERT INTO import_log (user_id, kind, source, ok, message, line_count, chord_lines) VALUES (?,?,?,?,?,?,?)"
    ).bind(user.id, kind, source, 1,
      `'${source}' — ${inserted.length} lög fundust`, totalLines, totalChords).run();
    return Response.json({ songs: inserted });
  }

  if (body.url) {
    kind = "url"; source = String(body.url).slice(0, 500);
    let url;
    try { url = new URL(body.url); if (!/^https?:$/.test(url.protocol)) throw 0; }
    catch { return fail(kind, source, "Þetta lítur ekki út eins og gild vefslóð."); }

    if (/(^|\.)guitarparty\.com$/.test(url.hostname)) {
      let gp;
      try { gp = await importFromGuitarparty(url); }
      catch { return fail(kind, source, "Gat ekki sótt lagið frá Guitarparty."); }
      if (gp.error) return fail(kind, source, gp.error);
      const song = await insertSong(title || gp.title, author || gp.author, gp.key, "guitarparty.com", gp.lines);
      await log(kind, source, true, `'${song.title}' — ${gp.lines.length} línur, ${countChordLines(gp.lines)} hljómalínur`, gp.lines);
      return Response.json({ songs: [song] });
    }

    let html;
    try {
      const res = await fetch(url, { headers: GP_UA, redirect: "follow" });
      if (!res.ok) return fail(kind, source, `Gat ekki sótt síðuna (HTTP ${res.status}).`);
      html = await res.text();
    } catch {
      return fail(kind, source, "Gat ekki sótt síðuna — athugaðu slóðina.");
    }
    sheetText = extractSheetFromHtml(html);
    if (!sheetText) return fail(kind, source, "Fann engar hljómalínur á síðunni.");
    if (!title) title = extractTitleFromHtml(html);
  } else if (body.pdfText !== undefined) {
    kind = "pdf"; source = (body.filename ?? "PDF").slice(0, 200);
    sheetText = String(body.pdfText);
    if (!sheetText.trim())
      return fail(kind, source, "PDF-skjalið inniheldur engan texta — líklega skönnuð mynd. OCR kemur í næstu útgáfu.");
  } else if (body.pasted !== undefined) {
    kind = "paste"; source = "límt inn";
    sheetText = String(body.pasted);
    if (!sheetText.trim()) return fail(kind, source, "Enginn texti til að greina.");
  } else {
    return Response.json({ error: "Vantar url, pdfText eða pasted." }, { status: 400 });
  }

  const lines = parseSheet(sheetText);
  if (!lines.length) return fail(kind, source, "Gat ekki greint lag úr textanum.");

  const song = await insertSong(title, author, songKey, source, lines);
  await log(kind, source, true, `'${song.title}' — ${lines.length} línur, ${countChordLines(lines)} hljómalínur`, lines);

  return Response.json({ songs: [song] });
}
