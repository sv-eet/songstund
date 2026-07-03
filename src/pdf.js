/* Client-side PDF text extraction (keeps the Worker light).
   Chord sheets depend on horizontal alignment, so we rebuild each line
   from the glyph positions: group items by y, sort by x, and pad gaps
   with spaces so chords stay above the right syllables.

   Guitarparty songbook exports get special treatment: they are laid out
   in two columns, one song per title heading, with a cover page, a table
   of contents, and running headers — extractPdfSongs() splits all of
   that into individual { title, author, sheet } songs.

   The functions below are pure (they take pdf.js text items) so they can
   be exercised in Node; only loadPdf/extractPdfSongs touch the browser. */

/* Rebuild text lines (with font size) from one page's items, using exact
   glyph widths where available so columns of chords line up. */
export function buildLines(items) {
  const rows = new Map();
  for (const item of items) {
    if (!item.str) continue;
    const x = item.transform[4];
    const y = Math.round(item.transform[5] / 2) * 2;
    const size = Math.abs(item.transform[0]) || 10;
    if (!rows.has(y)) rows.set(y, []);
    rows.get(y).push({ x, str: item.str, size, width: item.width || 0 });
  }
  const lines = [];
  for (const y of [...rows.keys()].sort((a, b) => b - a)) {
    const row = rows.get(y).sort((a, b) => a.x - b.x);
    const charW = (row[0].size || 10) * 0.5;
    let text = "", cursor = row[0].x;
    for (const it of row) {
      const w = it.width > 0 ? it.width : it.str.length * charW;
      if (!it.str.trim()) {
        // Whitespace-only run: its width IS the gap (PDFs often encode a
        // 17-column gap as one stretched space character).
        text += " ".repeat(Math.max(it.str ? 1 : 0, Math.round(w / charW)));
        cursor = it.x + w;
        continue;
      }
      const pad = Math.max(0, Math.round((it.x - cursor) / charW));
      text += " ".repeat(pad) + it.str;
      cursor = it.x + w;
    }
    lines.push({ text: text.trimEnd(), size: Math.max(...row.map((r) => r.size)) });
  }
  return lines;
}

const GP_MARK = /guitarparty\.com/i;
const isHeaderFooter = (l) => GP_MARK.test(l.text) || /^Bls\.?\s*\d+\s*$/.test(l.text.trim());

/* pagesRaw: [{ items, width }] straight from pdf.js. */
export function pagesToLines(pagesRaw) {
  return pagesRaw.map(({ items, width }) => {
    const gp = items.some((i) => GP_MARK.test(i.str ?? ""));
    let lines;
    if (gp) {
      // Two-column layout: rebuild each column separately, read left then right.
      const mid = width / 2;
      lines = [
        ...buildLines(items.filter((i) => i.transform[4] < mid)),
        ...buildLines(items.filter((i) => i.transform[4] >= mid)),
      ].filter((l) => !isHeaderFooter(l));
    } else {
      lines = buildLines(items).filter((l) => !isHeaderFooter(l));
    }
    return { gp, lines };
  });
}

function parseAuthorMeta(text) {
  const artists = text.match(/Artists?:\s*(.+?)[,\s]*$/i);
  if (artists) return artists[1].trim();
  const songBy = text.match(/Song by:\s*([^,]+)/i);
  if (songBy) return songBy[1].trim();
  return "";
}

export function pagesToSongs(pages) {
  if (!pages.some((p) => p.gp)) {
    // Generic PDF: one song, whole document.
    const sheet = pages.map((p) => p.lines.map((l) => l.text).join("\n")).join("\n\n").trim();
    return sheet ? [{ title: "", author: "", sheet }] : [];
  }

  // Guitarparty songbook: split on large-font titles; a song continues
  // across pages until the next title.
  const songs = [];
  let cur = null;
  for (const page of pages) {
    for (const ln of page.lines) {
      const t = ln.text.trim();
      if (ln.size >= 16 && t) {
        if (/^(table of contents|efnisyfirlit)$/i.test(t)) { cur = null; continue; }
        cur = { title: t, author: "", body: [] };
        songs.push(cur);
      } else if (cur) {
        if (ln.size < 10 && /(Song by|Lyrics by|Artists?):/i.test(t)) {
          if (!cur.author) cur.author = parseAuthorMeta(t);
        } else {
          cur.body.push(ln.text);
        }
      }
    }
  }

  return songs
    .map((s) => ({
      title: s.title,
      author: s.author,
      sheet: s.body.join("\n").replace(/\n{3,}/g, "\n\n").trim(),
    }))
    .filter((s) => s.sheet.replace(/[\s.]/g, "").length > 0);
}

/* ── browser-only entry points ─────────────────────────── */

async function readPagesRaw(file) {
  const pdfjs = await import("pdfjs-dist");
  const workerUrl = (await import("pdfjs-dist/build/pdf.worker.min.mjs?url")).default;
  pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;
  const doc = await pdfjs.getDocument({ data: await file.arrayBuffer() }).promise;
  const pagesRaw = [];
  for (let p = 1; p <= doc.numPages; p++) {
    const page = await doc.getPage(p);
    const content = await page.getTextContent();
    pagesRaw.push({ items: content.items, width: page.getViewport({ scale: 1 }).width });
  }
  return pagesRaw;
}

export async function extractPdfSongs(file) {
  return pagesToSongs(pagesToLines(await readPagesRaw(file)));
}
