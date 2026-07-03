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

  let kind, source, sheetText, title = (body.title ?? "").trim(), author = (body.author ?? "").trim();

  if (body.url) {
    kind = "url"; source = String(body.url).slice(0, 500);
    let url;
    try { url = new URL(body.url); if (!/^https?:$/.test(url.protocol)) throw 0; }
    catch { return fail(kind, source, "Þetta lítur ekki út eins og gild vefslóð."); }
    let html;
    try {
      const res = await fetch(url, { headers: { "User-Agent": "SongstundBot/1.0 (+https://songstund.samskiptalausnir.is)" }, redirect: "follow" });
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

  const id = crypto.randomUUID();
  const songTitle = title || "Ónefnt lag";
  await env.DB.prepare(
    "INSERT INTO songs (id, songbook_id, title, author, key, source, lines_json) VALUES (?,?,?,?,?,?,?)"
  ).bind(id, songbookId, songTitle, author, body.key ?? "", source, JSON.stringify(lines)).run();
  await log(kind, source, true, `'${songTitle}' — ${lines.length} línur, ${countChordLines(lines)} hljómalínur`, lines);

  return Response.json({
    song: { id, songbook_id: songbookId, title: songTitle, author, key: body.key ?? "", source, lines },
  });
}
