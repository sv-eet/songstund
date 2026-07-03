import { useState, useEffect, useRef, useCallback } from "react";

/* ═════════════════════════════════════════════════════════
   SÖNGSTUND · samskiptalausnir.is — platform demo
   ─ Player login (demo auth: any email/password works)
   ─ Songbook: import by pasting a chord sheet (REAL parser,
     same heuristic the Cloud Function will use), or demo
     URL / PDF import (canned samples through same parser)
   ─ Session: room code, join-URL, QR, host controls
   ─ Guest: lyrics view w/ optional chord toggle, live sync
   ─ Admin: mock users / subscriptions / parse log
   Sync = artifact shared storage (Firebase RTDB in prod)
   ═════════════════════════════════════════════════════════ */

/* ── chord-sheet parser (production-transferable) ──────── */

const CHORD_TOKEN = /^\(?[A-G](#|b)?(m|maj|min|dim|aug|add|sus)?[0-9]{0,2}(sus[24])?(\/[A-G](#|b)?)?\)?[.x*]?$/;

function isChordLine(line) {
  const tokens = line.trim().split(/\s+/).filter(Boolean);
  if (!tokens.length) return false;
  const hits = tokens.filter((t) => CHORD_TOKEN.test(t)).length;
  return hits / tokens.length >= 0.7;
}

function parseSheet(text) {
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

/* ── demo seed content (public domain) ─────────────────── */

const SEED_SHEETS = [
  {
    title: "Á Sprengisandi", author: "Grímur Thomsen · þjóðlag", key: "Am",
    sheet: `Am                E              Am
Ríðum, ríðum, rekum yfir sandinn,
         Dm             E
rennur sól á bak við Arnarfell.
Am                 E                Am
Hér á reiki er margur óhreinn andinn
        Dm              E        Am
úr því fer að skyggja á jökulsvell.
C                    G
Drottinn leiði drösulinn minn,
Am              E              Am
drjúgur verður síðasti áfanginn.`,
  },
  {
    title: "Krummavísur", author: "Jón Thoroddsen · þjóðlag", key: "Em",
    sheet: `Em                 Am
Krummi svaf í klettagjá,
B7                Em
kaldri vetrarnóttu á,
        Am    B7
verður margt að meini.
Em                  Am
Fyrr en dagur fagur rann
B7                 Em
freðið nefið dregur hann
       Am    B7   Em
undan stórum steini.`,
  },
  {
    title: "Sofðu unga ástin mín", author: "Jóhann Sigurjónsson · þjóðlag", key: "Dm",
    sheet: `Dm             Gm
Sofðu unga ástin mín,
A7            Dm
úti regnið grætur.
Dm                Gm
Mamma geymir gullin þín,
C                 F
gamla leggi og völuskrín.
Gm            Dm       A7        Dm
Við skulum ekki vaka um dimmar nætur.`,
  },
];

const seedSongs = () =>
  SEED_SHEETS.map((s, i) => ({
    id: `seed-${i}`, title: s.title, author: s.author, key: s.key,
    source: "guitarparty.com (demo)", lines: parseSheet(s.sheet),
  }));

/* ── theme ─────────────────────────────────────────────── */

const T = {
  bg: "#171310", surface: "#241D18", raised: "#2E251E", line: "#3A2F26",
  ink: "#EFE4D2", dim: "#9A8875", faint: "#6B5D4E",
  amber: "#F0A85C", amberDeep: "#B5731F", live: "#8FBB7A", red: "#C96C5B",
};
const mono = "'SF Mono',ui-monospace,'Cascadia Mono',Consolas,monospace";
const serif = "'Iowan Old Style','Palatino Linotype',Palatino,Georgia,serif";

/* ── storage helpers ───────────────────────────────────── */

const roomKey = (c) => `songstund-room-${c}`;
const userKey = (e) => `songstund-user-${e.replace(/[^a-z0-9]/gi, "_")}`;
const makeCode = () =>
  Array.from({ length: 4 }, () => "BDFGHJKLMNPRSTV"[Math.floor(Math.random() * 15)]).join("");

async function sGet(key, shared = false) {
  try { const r = await window.storage.get(key, shared); return r ? JSON.parse(r.value) : null; }
  catch { return null; }
}
async function sSet(key, val, shared = false) {
  try { await window.storage.set(key, JSON.stringify(val), shared); } catch (e) { console.error(e); }
}

/* ── tiny UI atoms ─────────────────────────────────────── */

function Tag({ children, color = T.dim }) {
  return <span style={{ fontFamily: mono, fontSize: 11, letterSpacing: "0.14em", textTransform: "uppercase", color }}>{children}</span>;
}
const btnBase = { font: "inherit", cursor: "pointer", borderRadius: 10, border: `1px solid ${T.line}` };
function Btn({ primary, danger, style, ...p }) {
  return <button {...p} style={{
    ...btnBase, padding: "12px 18px", fontSize: 15, fontWeight: primary ? 600 : 400,
    background: primary ? T.amber : "transparent",
    color: primary ? "#221708" : danger ? T.red : T.ink,
    borderColor: primary ? T.amber : danger ? "#5A3730" : T.line, ...style,
  }} />;
}
function Input(p) {
  return <input {...p} style={{
    background: T.surface, border: `1px solid ${T.line}`, borderRadius: 10,
    color: T.ink, padding: "13px 15px", fontSize: 16, width: "100%", font: "inherit", ...p.style,
  }} />;
}

/* ── decorative QR (real QR lib in production) ─────────── */

function QRBlock({ code }) {
  const N = 21;
  let h = 0; for (const ch of code) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  const cells = [];
  const finder = (r, c) =>
    (r < 7 && c < 7) || (r < 7 && c >= N - 7) || (r >= N - 7 && c < 7);
  const finderOn = (r, c) => {
    const rr = r >= N - 7 ? r - (N - 7) : r, cc = c >= N - 7 ? c - (N - 7) : c;
    return rr === 0 || rr === 6 || cc === 0 || cc === 6 || (rr >= 2 && rr <= 4 && cc >= 2 && cc <= 4);
  };
  for (let r = 0; r < N; r++) for (let c = 0; c < N; c++) {
    let on;
    if (finder(r, c)) on = finderOn(r, c);
    else { h = (h * 1103515245 + 12345) >>> 0; on = (h >> 16) % 2 === 0; }
    cells.push(on);
  }
  return (
    <div aria-label={`QR kóði fyrir ${code} (sýnishorn)`} style={{
      display: "grid", gridTemplateColumns: `repeat(${N},1fr)`,
      width: 148, height: 148, background: "#F5EFE3", padding: 10, borderRadius: 10,
    }}>
      {cells.map((on, i) => <div key={i} style={{ background: on ? "#20160C" : "transparent" }} />)}
    </div>
  );
}

/* ── song renderer (one format, chord toggle) ──────────── */

function SongLines({ song, current = -1, showChords, onTapLine, refs, dimPast }) {
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

/* ── login ─────────────────────────────────────────────── */

function Login({ onIn }) {
  const [email, setEmail] = useState("");
  const [pw, setPw] = useState("");
  const ok = email.includes("@") && pw.length >= 4;
  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", justifyContent: "center", padding: 24, maxWidth: 420, width: "100%", margin: "0 auto" }}>
      <Tag color={T.amber}>söngstund · samskiptalausnir.is</Tag>
      <h1 style={{ fontSize: 38, fontWeight: 500, margin: "10px 0 4px" }}>Spilarasvæði</h1>
      <p style={{ color: T.dim, marginBottom: 28, lineHeight: 1.5 }}>
        Skráðu þig inn til að halda utan um söngbókina þína og hefja söngstund.
      </p>
      <div style={{ display: "grid", gap: 10 }}>
        <Input placeholder="Netfang" type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
        <Input placeholder="Lykilorð" type="password" value={pw} onChange={(e) => setPw(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && ok && onIn(email)} />
        <Btn primary disabled={!ok} onClick={() => onIn(email)} style={{ opacity: ok ? 1 : 0.5 }}>Skrá inn</Btn>
      </div>
      <p style={{ color: T.faint, fontSize: 13, marginTop: 16 }}>
        Sýnishorn — hvaða netfang og lykilorð sem er virkar. Í raunútgáfu: Firebase Auth + áskrift um Stripe.
      </p>
    </div>
  );
}

/* ── import modal ──────────────────────────────────────── */

const DEMO_URL_SHEET = `G                 C          G
Nú blika við sólarlag sædjúpin köld,
                  D
ó, svona ætti að vera hvert einasta kvöld,
G               C            G
með hreinan og ljúfan og heilnæman blæ
        D                  G
og himininn bláan og speglandi sæ.`;

function ImportModal({ onClose, onAdd }) {
  const [tab, setTab] = useState("paste");
  const [title, setTitle] = useState("");
  const [author, setAuthor] = useState("");
  const [text, setText] = useState("");
  const [url, setUrl] = useState("https://www.guitarparty.com/lag/...");
  const [busy, setBusy] = useState(false);

  const finish = (t, a, sheet, source) => {
    const lines = parseSheet(sheet);
    if (!lines.length) return;
    onAdd({ id: `s-${Date.now()}`, title: t || "Ónefnt lag", author: a || "", key: "", source, lines });
    onClose();
  };

  const fakeFetch = (label, seed) => {
    setBusy(true);
    setTimeout(() => {
      setBusy(false);
      finish(seed.title, seed.author, seed.sheet, label);
    }, 900);
  };

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(10,7,5,0.75)", display: "flex", alignItems: "flex-end", justifyContent: "center", zIndex: 50 }}
      onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()} style={{
        background: T.surface, borderRadius: "18px 18px 0 0", width: "100%", maxWidth: 560,
        maxHeight: "88vh", overflowY: "auto", padding: "20px 22px 30px", border: `1px solid ${T.line}`,
      }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
          <h3 style={{ fontSize: 20, fontWeight: 500 }}>Bæta lagi í söngbók</h3>
          <button onClick={onClose} style={{ ...btnBase, background: "none", color: T.dim, padding: "6px 12px" }}>✕</button>
        </div>
        <div style={{ display: "flex", gap: 8, marginBottom: 18 }}>
          {[["paste", "Líma texta"], ["url", "Vefslóð"], ["pdf", "PDF"]].map(([k, l]) => (
            <button key={k} onClick={() => setTab(k)} style={{
              ...btnBase, padding: "8px 14px", fontSize: 14, flex: 1,
              background: tab === k ? T.raised : "none",
              color: tab === k ? T.amber : T.dim,
              borderColor: tab === k ? T.amberDeep : T.line,
            }}>{l}</button>
          ))}
        </div>

        {tab === "paste" && (
          <div style={{ display: "grid", gap: 10 }}>
            <Input placeholder="Titill" value={title} onChange={(e) => setTitle(e.target.value)} />
            <Input placeholder="Höfundur (valfrjálst)" value={author} onChange={(e) => setAuthor(e.target.value)} />
            <textarea value={text} onChange={(e) => setText(e.target.value)}
              placeholder={"Límdu hljómablað hér — parserinn þekkir hljómalínur sjálfkrafa:\n\nC        G\nDæmi um línu með hljómum yfir texta"}
              rows={9} style={{
                background: T.bg, border: `1px solid ${T.line}`, borderRadius: 10, color: T.ink,
                padding: 14, fontFamily: mono, fontSize: 13, width: "100%", resize: "vertical",
              }} />
            <Btn primary disabled={!text.trim()} onClick={() => finish(title, author, text, "límt inn")}
              style={{ opacity: text.trim() ? 1 : 0.5 }}>Greina og vista</Btn>
            <p style={{ color: T.faint, fontSize: 13 }}>
              Þetta er sami greiningarkóði og Cloud Function notar í raunútgáfu.
            </p>
          </div>
        )}

        {tab === "url" && (
          <div style={{ display: "grid", gap: 10 }}>
            <Input value={url} onChange={(e) => setUrl(e.target.value)} />
            <Btn primary disabled={busy} onClick={() => fakeFetch("guitarparty.com (demo)", {
              title: "Nú blika við sólarlag", author: "Þorsteinn Erlingsson · þjóðlag", sheet: DEMO_URL_SHEET,
            })}>{busy ? "Sæki og greini…" : "Sækja lag"}</Btn>
            <p style={{ color: T.faint, fontSize: 13 }}>
              Sýnishorn — skilar tilbúnu lagi. Í raunútgáfu sækir Cloud Function síðuna, les hljóma og texta úr HTML og vistar í Firestore.
            </p>
          </div>
        )}

        {tab === "pdf" && (
          <div style={{ display: "grid", gap: 10 }}>
            <div style={{ border: `1.5px dashed ${T.line}`, borderRadius: 12, padding: "34px 20px", textAlign: "center", color: T.dim }}>
              Dragðu PDF hingað eða veldu skrá
            </div>
            <Btn primary disabled={busy} onClick={() => fakeFetch("PDF (demo)", SEED_SHEETS[2])}>
              {busy ? "Les PDF og greini…" : "Hlaða upp sýnishorni"}
            </Btn>
            <p style={{ color: T.faint, fontSize: 13 }}>
              Raunútgáfa: pdf-parse dregur textann út, sama hljómagreining. Skannaðar myndir (án texta) fá vinsamlega villu í v1.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

/* ── songbook / dashboard ──────────────────────────────── */

function Dashboard({ email, songs, setSongs, onStart, onLogout, onAdmin }) {
  const [importing, setImporting] = useState(false);
  const [preview, setPreview] = useState(null);
  const [showChords, setShowChords] = useState(true);
  const prevSong = songs.find((s) => s.id === preview);

  if (prevSong) {
    return (
      <div style={{ flex: 1, maxWidth: 640, width: "100%", margin: "0 auto", padding: "20px 24px 60px" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
          <button onClick={() => setPreview(null)} style={{ ...btnBase, background: "none", border: "none", color: T.faint, padding: 0 }}>← Söngbók</button>
          <label style={{ display: "flex", alignItems: "center", gap: 8, color: T.dim, fontSize: 14, cursor: "pointer" }}>
            <input type="checkbox" checked={showChords} onChange={(e) => setShowChords(e.target.checked)} style={{ accentColor: T.amber }} />
            Sýna hljóma
          </label>
        </div>
        <h2 style={{ fontSize: 26, fontWeight: 500 }}>{prevSong.title}</h2>
        <p style={{ color: T.dim, fontSize: 13, marginBottom: 20 }}>{prevSong.author} · {prevSong.source}</p>
        <SongLines song={prevSong} showChords={showChords} />
      </div>
    );
  }

  return (
    <div style={{ flex: 1, maxWidth: 560, width: "100%", margin: "0 auto", padding: "22px 24px 60px" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <Tag color={T.amber}>söngstund</Tag>
        <div style={{ display: "flex", gap: 14 }}>
          <button onClick={onAdmin} style={{ ...btnBase, background: "none", border: "none", color: T.faint, fontSize: 13, padding: 0 }}>Stjórnborð</button>
          <button onClick={onLogout} style={{ ...btnBase, background: "none", border: "none", color: T.faint, fontSize: 13, padding: 0 }}>Útskrá</button>
        </div>
      </div>
      <h1 style={{ fontSize: 30, fontWeight: 500, margin: "14px 0 2px" }}>Söngbókin mín</h1>
      <p style={{ color: T.dim, fontSize: 14, marginBottom: 6 }}>{email}</p>
      <p style={{ marginBottom: 22 }}>
        <Tag color={T.live}>áskrift virk · demo</Tag>
      </p>

      <div style={{ display: "flex", gap: 10, marginBottom: 22 }}>
        <Btn primary style={{ flex: 1 }} onClick={onStart} disabled={!songs.length}>▶ Hefja söngstund</Btn>
        <Btn onClick={() => setImporting(true)}>＋ Lag</Btn>
      </div>

      {songs.length === 0 && (
        <p style={{ color: T.faint, textAlign: "center", padding: "40px 0" }}>
          Söngbókin er tóm — bættu við fyrsta laginu.
        </p>
      )}
      {songs.map((s) => (
        <div key={s.id} style={{
          display: "flex", justifyContent: "space-between", alignItems: "center",
          background: T.surface, border: `1px solid ${T.line}`, borderRadius: 12,
          padding: "14px 16px", marginBottom: 10,
        }}>
          <button onClick={() => setPreview(s.id)} style={{ ...btnBase, background: "none", border: "none", textAlign: "left", color: T.ink, padding: 0, flex: 1 }}>
            <span style={{ display: "block", fontSize: 17 }}>{s.title}</span>
            <span style={{ color: T.dim, fontSize: 13 }}>{s.author || s.source}</span>
          </button>
          <button onClick={() => setSongs(songs.filter((x) => x.id !== s.id))}
            aria-label={`Eyða ${s.title}`}
            style={{ ...btnBase, background: "none", border: "none", color: T.faint, padding: "4px 8px" }}>✕</button>
        </div>
      ))}

      {importing && <ImportModal onClose={() => setImporting(false)} onAdd={(s) => setSongs([...songs, s])} />}
    </div>
  );
}

/* ── host session ──────────────────────────────────────── */

function HostSession({ code, songs, onExit }) {
  const [songId, setSongId] = useState(null);
  const [line, setLine] = useState(0);
  const [auto, setAuto] = useState(false);
  const [secs, setSecs] = useState(6);
  const [showChords, setShowChords] = useState(true);
  const song = songs.find((s) => s.id === songId);
  const refs = useRef([]);

  const broadcast = useCallback(() => {
    sSet(roomKey(code), {
      code, line, at: Date.now(),
      song: song ? { title: song.title, author: song.author, lines: song.lines } : null,
    }, true);
  }, [code, line, song]);

  useEffect(() => { broadcast(); }, [broadcast]);
  useEffect(() => { const t = setInterval(broadcast, 8000); return () => clearInterval(t); }, [broadcast]);

  useEffect(() => {
    if (!auto || !song) return;
    const t = setInterval(() => {
      setLine((l) => {
        let n = l + 1;
        while (n < song.lines.length && !song.lines[n].t) n++;
        return n < song.lines.length ? n : l;
      });
    }, secs * 1000);
    return () => clearInterval(t);
  }, [auto, secs, song]);

  useEffect(() => { refs.current[line]?.scrollIntoView({ block: "center", behavior: "smooth" }); }, [line]);

  const joinUrl = `samskiptalausnir.is/s/${code}`;

  if (!song) {
    return (
      <div style={{ flex: 1, maxWidth: 560, width: "100%", margin: "0 auto", padding: "22px 24px 60px" }}>
        <button onClick={onExit} style={{ ...btnBase, background: "none", border: "none", color: T.faint, padding: 0 }}>← Loka söngstund</button>
        <h2 style={{ fontSize: 26, fontWeight: 500, margin: "18px 0 14px" }}>Söngstund í gangi</h2>
        <div style={{ display: "flex", gap: 18, alignItems: "center", background: T.surface, border: `1px solid ${T.line}`, borderRadius: 14, padding: 18, marginBottom: 22 }}>
          <QRBlock code={code} />
          <div>
            <Tag>kóði</Tag>
            <div style={{ fontFamily: mono, fontSize: 30, letterSpacing: "0.25em", color: T.amber, margin: "2px 0 10px" }}>{code}</div>
            <Tag>slóð</Tag>
            <div style={{ fontFamily: mono, fontSize: 13, color: T.dim, wordBreak: "break-all" }}>{joinUrl}</div>
          </div>
        </div>
        <p style={{ color: T.dim, fontSize: 15, marginBottom: 14 }}>Veldu lag til að byrja:</p>
        {songs.map((s) => (
          <button key={s.id} onClick={() => { setSongId(s.id); setLine(0); }} style={{
            ...btnBase, display: "block", width: "100%", textAlign: "left",
            background: T.surface, color: T.ink, padding: "15px 17px", marginBottom: 10, fontSize: 17,
          }}>{s.title}<span style={{ color: T.dim, fontSize: 13, display: "block" }}>{s.author || s.source}</span></button>
        ))}
      </div>
    );
  }

  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", maxWidth: 640, width: "100%", margin: "0 auto" }}>
      <div style={{ padding: "18px 24px 8px" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <button onClick={() => { setSongId(null); setAuto(false); }} style={{ ...btnBase, background: "none", border: "none", color: T.faint, padding: 0 }}>← Lagaval</button>
          <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
            <label style={{ display: "flex", alignItems: "center", gap: 6, color: T.dim, fontSize: 13, cursor: "pointer" }}>
              <input type="checkbox" checked={showChords} onChange={(e) => setShowChords(e.target.checked)} style={{ accentColor: T.amber }} />
              Hljómar
            </label>
            <span style={{ fontFamily: mono, letterSpacing: "0.25em", color: T.amber, fontSize: 15 }}>{code}</span>
          </div>
        </div>
        <h2 style={{ fontSize: 22, fontWeight: 500, marginTop: 12 }}>{song.title}</h2>
      </div>

      <div style={{ flex: 1, overflowY: "auto", padding: "10px 24px 150px" }}>
        <SongLines song={song} current={line} showChords={showChords} onTapLine={setLine} refs={refs} />
      </div>

      <div style={{ position: "fixed", bottom: 0, left: 0, right: 0, background: "linear-gradient(transparent, #171310 30%)", padding: "26px 24px 20px" }}>
        <div style={{ maxWidth: 592, margin: "0 auto", display: "flex", gap: 10, alignItems: "center" }}>
          <Btn primary={auto} onClick={() => setAuto((a) => !a)} style={{ flexShrink: 0 }}>
            {auto ? "❚❚" : "▶"} Sjálfvirkt
          </Btn>
          <label style={{ flex: 1, display: "flex", alignItems: "center", gap: 10, color: T.dim, fontSize: 13 }}>
            Hraði
            <input type="range" min={3} max={12} value={15 - secs} onChange={(e) => setSecs(15 - Number(e.target.value))}
              style={{ flex: 1, accentColor: T.amber }} aria-label="Skrunhraði" />
          </label>
          <Btn onClick={() => setLine((l) => Math.min(l + 1, song.lines.length - 1))} style={{ flexShrink: 0, background: T.raised }}>Næsta ↓</Btn>
        </div>
      </div>
    </div>
  );
}

/* ── guest ─────────────────────────────────────────────── */

function Guest({ code, onExit }) {
  const [state, setState] = useState(null);
  const [lost, setLost] = useState(false);
  const [showChords, setShowChords] = useState(false);
  const refs = useRef([]);

  useEffect(() => {
    let live = true;
    const tick = async () => {
      const s = await sGet(roomKey(code), true);
      if (!live) return;
      if (s) { setState(s); setLost(Date.now() - s.at > 25000); }
    };
    tick();
    const t = setInterval(tick, 1000);
    return () => { live = false; clearInterval(t); };
  }, [code]);

  useEffect(() => {
    if (state?.song) refs.current[state.line]?.scrollIntoView({ block: "center", behavior: "smooth" });
  }, [state?.line, state?.song?.title]);

  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", maxWidth: 560, width: "100%", margin: "0 auto" }}>
      <div style={{ padding: "18px 24px 6px", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <button onClick={onExit} style={{ ...btnBase, background: "none", border: "none", color: T.faint, fontSize: 14, padding: 0 }}>← Hætta</button>
        <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
          <label style={{ display: "flex", alignItems: "center", gap: 6, color: T.dim, fontSize: 13, cursor: "pointer" }}>
            <input type="checkbox" checked={showChords} onChange={(e) => setShowChords(e.target.checked)} style={{ accentColor: T.amber }} />
            Hljómar
          </label>
          <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <span style={{ width: 8, height: 8, borderRadius: "50%", background: lost ? T.faint : T.live, animation: lost ? "none" : "pulse 2s infinite" }} />
            <Tag color={lost ? T.faint : T.live}>{lost ? "samband rofið" : code}</Tag>
          </span>
        </div>
      </div>

      {!state?.song ? (
        <div style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: 24, textAlign: "center" }}>
          <div style={{ fontSize: 40, marginBottom: 14 }}>♪</div>
          <p style={{ color: T.dim, fontSize: 16, maxWidth: 300, lineHeight: 1.5 }}>
            {state ? "Beðið eftir að gítarleikarinn velji lag …" : "Leita að söngstund …"}
          </p>
        </div>
      ) : (
        <div style={{ flex: 1, overflowY: "auto", padding: "8px 28px 50vh" }}>
          <h2 style={{ fontSize: 22, fontWeight: 500, margin: "10px 0 2px" }}>{state.song.title}</h2>
          <p style={{ color: T.faint, fontSize: 13, marginBottom: 22 }}>{state.song.author}</p>
          <SongLines song={state.song} current={state.line} showChords={showChords} refs={refs} dimPast />
        </div>
      )}
    </div>
  );
}

/* ── admin ─────────────────────────────────────────────── */

const MOCK_USERS = [
  { email: "spilari1@example.is", plan: "Árs", status: "virk", songs: 24, sessions: 11 },
  { email: "spilari2@example.is", plan: "Mánaðar", status: "virk", songs: 8, sessions: 3 },
  { email: "spilari3@example.is", plan: "Prufa", status: "rennur út 12.7.", songs: 2, sessions: 1 },
];
const MOCK_LOG = [
  { t: "14:02", msg: "URL greint: 'Ferðalok' — 42 línur, 38 hljómalínur", ok: true },
  { t: "13:47", msg: "PDF greint: 'Söngbók 2024.pdf' — 6 lög fundust", ok: true },
  { t: "12:15", msg: "PDF hafnað: skönnuð mynd án texta (OCR í v2)", ok: false },
];

function Admin({ onBack }) {
  const th = { textAlign: "left", padding: "8px 10px", color: T.faint, fontFamily: mono, fontSize: 11, letterSpacing: "0.1em", textTransform: "uppercase", borderBottom: `1px solid ${T.line}` };
  const td = { padding: "10px", fontSize: 14, borderBottom: `1px solid ${T.line}` };
  return (
    <div style={{ flex: 1, maxWidth: 640, width: "100%", margin: "0 auto", padding: "22px 24px 60px" }}>
      <button onClick={onBack} style={{ ...btnBase, background: "none", border: "none", color: T.faint, padding: 0 }}>← Til baka</button>
      <h1 style={{ fontSize: 28, fontWeight: 500, margin: "16px 0 4px" }}>Stjórnborð</h1>
      <p style={{ color: T.dim, fontSize: 14, marginBottom: 24 }}>Sýnigögn — raunútgáfa les úr Firestore + Stripe.</p>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 10, marginBottom: 26 }}>
        {[["Notendur", "3"], ["Virkar áskriftir", "2"], ["Söngstundir í dag", "5"]].map(([l, v]) => (
          <div key={l} style={{ background: T.surface, border: `1px solid ${T.line}`, borderRadius: 12, padding: "14px 14px" }}>
            <div style={{ fontSize: 26, color: T.amber, fontWeight: 500 }}>{v}</div>
            <div style={{ color: T.dim, fontSize: 12 }}>{l}</div>
          </div>
        ))}
      </div>

      <h3 style={{ fontSize: 17, fontWeight: 500, marginBottom: 8 }}>Notendur</h3>
      <div style={{ overflowX: "auto", background: T.surface, border: `1px solid ${T.line}`, borderRadius: 12, marginBottom: 26 }}>
        <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 430 }}>
          <thead><tr><th style={th}>Netfang</th><th style={th}>Áskrift</th><th style={th}>Staða</th><th style={th}>Lög</th></tr></thead>
          <tbody>{MOCK_USERS.map((u) => (
            <tr key={u.email}>
              <td style={td}>{u.email}</td><td style={td}>{u.plan}</td>
              <td style={{ ...td, color: u.status === "virk" ? T.live : T.amber }}>{u.status}</td>
              <td style={td}>{u.songs}</td>
            </tr>
          ))}</tbody>
        </table>
      </div>

      <h3 style={{ fontSize: 17, fontWeight: 500, marginBottom: 8 }}>Greiningarskrá</h3>
      {MOCK_LOG.map((l, i) => (
        <div key={i} style={{ display: "flex", gap: 12, padding: "10px 4px", borderBottom: `1px solid ${T.line}`, fontSize: 14 }}>
          <span style={{ fontFamily: mono, color: T.faint, fontSize: 12, paddingTop: 2 }}>{l.t}</span>
          <span style={{ color: l.ok ? T.dim : T.red, lineHeight: 1.4 }}>{l.msg}</span>
        </div>
      ))}
    </div>
  );
}

/* ── landing + app shell ───────────────────────────────── */

function Landing({ onLogin, onJoin }) {
  const [code, setCode] = useState("");
  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", justifyContent: "center", padding: "32px 24px", maxWidth: 460, width: "100%", margin: "0 auto" }}>
      <Tag color={T.amber}>söngstund · samskiptalausnir.is</Tag>
      <h1 style={{ fontSize: "clamp(34px,9vw,52px)", fontWeight: 500, lineHeight: 1.05, margin: "10px 0 6px" }}>
        Einn spilar.<br />Allir syngja.
      </h1>
      <p style={{ color: T.dim, fontSize: 16, lineHeight: 1.5, marginBottom: 34 }}>
        Gestir skanna QR-kóða og fylgja textanum í rauntíma — gítarleikarinn stjórnar ferðinni.
      </p>
      <div style={{ display: "flex", gap: 10, marginBottom: 22 }}>
        <Input value={code} onChange={(e) => setCode(e.target.value.toUpperCase().slice(0, 4))}
          placeholder="KÓÐI" aria-label="Kóði söngstundar"
          style={{ fontFamily: mono, letterSpacing: "0.35em", textAlign: "center", fontSize: 20, flex: 1 }} />
        <Btn onClick={() => code.length === 4 && onJoin(code)} disabled={code.length !== 4}
          style={{ background: T.raised, opacity: code.length === 4 ? 1 : 0.6 }}>Syngja með</Btn>
      </div>
      <Btn primary onClick={onLogin}>Spilarasvæði — innskráning</Btn>
    </div>
  );
}

export default function App() {
  const [route, setRoute] = useState({ view: "landing" });
  const [email, setEmail] = useState(null);
  const [songs, setSongsState] = useState([]);

  const setSongs = (next) => { setSongsState(next); if (email) sSet(userKey(email), next); };

  const login = async (e) => {
    setEmail(e);
    const saved = await sGet(userKey(e));
    setSongsState(saved && saved.length ? saved : seedSongs());
    if (!saved) sSet(userKey(e), seedSongs());
    setRoute({ view: "dash" });
  };

  return (
    <div style={{ minHeight: "100vh", background: T.bg, color: T.ink, fontFamily: serif, display: "flex", flexDirection: "column" }}>
      <style>{`
        * { box-sizing: border-box; margin: 0; }
        button:focus-visible, input:focus-visible, textarea:focus-visible { outline: 2px solid ${T.amber}; outline-offset: 2px; }
        @keyframes pulse { 0%,100%{opacity:.5} 50%{opacity:1} }
        @media (prefers-reduced-motion: reduce) { * { animation:none!important; transition:none!important; scroll-behavior:auto!important } }
        ::selection { background: ${T.amberDeep}; color: ${T.bg}; }
        input::placeholder, textarea::placeholder { color: ${T.faint}; }
      `}</style>

      {route.view === "landing" && <Landing onLogin={() => setRoute({ view: "login" })} onJoin={(c) => setRoute({ view: "guest", code: c })} />}
      {route.view === "login" && <Login onIn={login} />}
      {route.view === "dash" && email && (
        <Dashboard email={email} songs={songs} setSongs={setSongs}
          onStart={() => setRoute({ view: "host", code: makeCode() })}
          onAdmin={() => setRoute({ view: "admin" })}
          onLogout={() => { setEmail(null); setRoute({ view: "landing" }); }} />
      )}
      {route.view === "host" && <HostSession code={route.code} songs={songs} onExit={() => setRoute({ view: "dash" })} />}
      {route.view === "guest" && <Guest code={route.code} onExit={() => setRoute({ view: "landing" })} />}
      {route.view === "admin" && <Admin onBack={() => setRoute({ view: "dash" })} />}
    </div>
  );
}
