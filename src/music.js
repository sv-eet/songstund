/* Chord transposition and accent-insensitive text matching. */

const SHARP = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
const NOTE_INDEX = {
  C: 0, "C#": 1, Db: 1, D: 2, "D#": 3, Eb: 3, E: 4, F: 5,
  "F#": 6, Gb: 6, G: 7, "G#": 8, Ab: 8, A: 9, "A#": 10, Bb: 10, B: 11,
};

export function transposeChordLine(line, n) {
  if (!n) return line;
  return line.replace(/([A-G])(#|b)?/g, (m, root, acc) => {
    const i = NOTE_INDEX[root + (acc ?? "")];
    return i === undefined ? m : SHARP[(i + n + 120) % 12];
  });
}

export function transposeLines(lines, n) {
  if (!n) return lines;
  return lines.map((l) => (l.c ? { ...l, c: transposeChordLine(l.c, n) } : l));
}

const ACCENTS = { á: "a", à: "a", ä: "a", é: "e", è: "e", ë: "e", í: "i", ì: "i", ï: "i", ó: "o", ò: "o", ö: "o", ú: "u", ù: "u", ü: "u", ý: "y", ð: "d", þ: "th", æ: "ae", å: "a", ø: "o" };

// Lowercase and strip Icelandic/Latin accents so "osk" finds "Ósk".
export function normalize(s) {
  return String(s).toLowerCase().replace(/[áàäéèëíìïóòöúùüýðþæåø]/g, (ch) => ACCENTS[ch] ?? ch);
}
