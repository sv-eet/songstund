// Chord-sheet parser — same heuristic as the original demo (songstund-platform.jsx).

const CHORD_TOKEN = /^\(?[A-G](#|b)?(m|maj|min|dim|aug|add|sus)?[0-9]{0,2}(sus[24])?(\/[A-G](#|b)?)?\)?[.x*]?$/;

export function isChordLine(line) {
  const tokens = line.trim().split(/\s+/).filter(Boolean);
  if (!tokens.length) return false;
  const hits = tokens.filter((t) => CHORD_TOKEN.test(t)).length;
  return hits / tokens.length >= 0.7;
}

export function parseSheet(text) {
  const raw = text.replace(/\r/g, "").split("\n");
  const lines = [];
  for (let i = 0; i < raw.length; i++) {
    const l = raw[i];
    if (!l.trim()) { lines.push({ c: "", t: "" }); continue; }
    if (isChordLine(l)) {
      const next = raw[i + 1];
      if (next && next.trim() && !isChordLine(next)) {
        lines.push({ c: l.trimEnd(), t: next.trimEnd() });
        i++;
      } else lines.push({ c: l.trimEnd(), t: "" });
    } else lines.push({ c: "", t: l.trimEnd() });
  }
  while (lines.length && !lines[lines.length - 1].t && !lines[lines.length - 1].c) lines.pop();
  return lines;
}

export function countChordLines(lines) {
  return lines.filter((l) => l.c).length;
}
