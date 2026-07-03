/* Client-side PDF text extraction (keeps the Worker light).
   Chord sheets depend on horizontal alignment, so we rebuild each line
   from the glyph positions: group items by y, sort by x, and pad gaps
   with spaces so chords stay above the right syllables. */

export async function extractPdfText(file) {
  const pdfjs = await import("pdfjs-dist");
  const workerUrl = (await import("pdfjs-dist/build/pdf.worker.min.mjs?url")).default;
  pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;

  const data = await file.arrayBuffer();
  const doc = await pdfjs.getDocument({ data }).promise;
  const pages = [];

  for (let p = 1; p <= doc.numPages; p++) {
    const page = await doc.getPage(p);
    const content = await page.getTextContent();

    // Group text items into rows by (rounded) baseline y.
    const rows = new Map();
    for (const item of content.items) {
      if (!item.str) continue;
      const x = item.transform[4];
      const y = Math.round(item.transform[5] / 2) * 2;
      const size = Math.abs(item.transform[0]) || 10;
      if (!rows.has(y)) rows.set(y, []);
      rows.get(y).push({ x, str: item.str, size });
    }

    const sortedYs = [...rows.keys()].sort((a, b) => b - a); // top of page first
    const lines = [];
    for (const y of sortedYs) {
      const items = rows.get(y).sort((a, b) => a.x - b.x);
      const charW = (items[0].size || 10) * 0.5; // approx monospace advance
      let line = "", cursor = items[0].x;
      for (const it of items) {
        const pad = Math.max(0, Math.round((it.x - cursor) / charW));
        line += " ".repeat(pad) + it.str;
        cursor = it.x + it.str.length * charW;
      }
      lines.push(line.trimEnd());
    }
    pages.push(lines.join("\n"));
  }

  return pages.join("\n\n");
}
