import { T, mono, serif } from "./theme.js";

export function Tag({ children, color = T.dim }) {
  return <span style={{ fontFamily: mono, fontSize: 11, letterSpacing: "0.14em", textTransform: "uppercase", color }}>{children}</span>;
}

export const btnBase = { font: "inherit", cursor: "pointer", borderRadius: 10, border: `1px solid ${T.line}` };

export function Btn({ primary, danger, style, ...p }) {
  return <button {...p} style={{
    ...btnBase, padding: "12px 18px", fontSize: 15, fontWeight: primary ? 600 : 400,
    background: primary ? T.amber : "transparent",
    color: primary ? "#221708" : danger ? T.red : T.ink,
    borderColor: primary ? T.amber : danger ? "#5A3730" : T.line, ...style,
  }} />;
}

export function Input(p) {
  return <input {...p} style={{
    background: T.surface, border: `1px solid ${T.line}`, borderRadius: 10,
    color: T.ink, padding: "13px 15px", fontSize: 16, width: "100%", font: "inherit", ...p.style,
  }} />;
}

export function ErrorText({ children }) {
  if (!children) return null;
  return <p style={{ color: T.red, fontSize: 14, lineHeight: 1.4 }}>{children}</p>;
}

/* ── song renderer (one format, chord toggle) ──────────── */

export function SongLines({ song, current = -1, showChords, onTapLine, refs, dimPast }) {
  return song.lines.map((ln, i) =>
    !ln.t && !ln.c ? <div key={i} style={{ height: 26 }} /> : (
      <div key={i} ref={refs ? (el) => (refs.current[i] = el) : undefined}
        onClick={onTapLine ? () => onTapLine(i) : undefined}
        role={onTapLine ? "button" : undefined}
        style={{
          padding: "5px 12px", marginLeft: -12, borderRadius: 8,
          cursor: onTapLine ? "pointer" : "default",
          borderLeft: `3px solid ${i === current ? T.amber : "transparent"}`,
          background: i === current ? "rgba(240,168,92,0.08)" : "none",
          transition: "background .25s, border-color .25s",
        }}>
        {showChords && ln.c && (
          <div style={{ fontFamily: mono, fontSize: 13, whiteSpace: "pre", overflowX: "auto",
            color: i === current ? T.amber : T.amberDeep }}>{ln.c}</div>
        )}
        {ln.t && (
          <div style={{
            fontFamily: showChords ? mono : serif,
            fontSize: showChords ? 16 : 20, lineHeight: 1.5,
            whiteSpace: showChords ? "pre-wrap" : "normal",
            color: i === current ? T.ink : dimPast && i < current ? T.faint : T.dim,
            textShadow: i === current && !showChords ? "0 0 26px rgba(240,168,92,0.4)" : "none",
            transition: "color .4s",
          }}>{ln.t}</div>
        )}
      </div>
    )
  );
}
