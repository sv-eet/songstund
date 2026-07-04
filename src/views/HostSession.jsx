import { useState, useEffect, useRef, useCallback } from "react";
import { T, mono } from "../theme.js";
import { Tag, Btn, SongLines, btnBase } from "../ui.jsx";
import { api, roomSocketUrl } from "../api.js";
import { useWakeLock } from "../wakelock.js";
import { transposeLines, normalize } from "../music.js";

function useHostSocket(code, onMessage) {
  const wsRef = useRef(null);
  const [connected, setConnected] = useState(false);
  const closedRef = useRef(false);
  const handlerRef = useRef(onMessage);
  handlerRef.current = onMessage;

  useEffect(() => {
    closedRef.current = false;
    let retry;
    const connect = () => {
      if (closedRef.current) return;
      const ws = new WebSocket(roomSocketUrl(code, true));
      wsRef.current = ws;
      ws.onopen = () => setConnected(true);
      ws.onmessage = (e) => {
        if (e.data === "pong") return;
        let msg; try { msg = JSON.parse(e.data); } catch { return; }
        handlerRef.current?.(msg);
      };
      ws.onclose = () => {
        setConnected(false);
        if (!closedRef.current) retry = setTimeout(connect, 2000);
      };
      ws.onerror = () => ws.close();
    };
    connect();
    const ping = setInterval(() => {
      if (wsRef.current?.readyState === WebSocket.OPEN) wsRef.current.send("ping");
    }, 20000);
    return () => {
      closedRef.current = true;
      clearInterval(ping); clearTimeout(retry);
      wsRef.current?.close();
    };
  }, [code]);

  const send = useCallback((msg) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) wsRef.current.send(JSON.stringify(msg));
  }, []);
  return { send, connected };
}

function QRCodeImg({ code, size = 148 }) {
  const [src, setSrc] = useState(null);
  useEffect(() => {
    let live = true;
    import("qrcode").then((QRCode) =>
      QRCode.toDataURL(`${location.origin}/s/${code}`, {
        width: size * 2, margin: 2,
        color: { dark: "#20160C", light: "#F5EFE3" },
      }).then((url) => live && setSrc(url))
    );
    return () => { live = false; };
  }, [code, size]);
  if (!src) return <div style={{ width: size, height: size, background: "#F5EFE3", borderRadius: 10 }} />;
  return <img src={src} alt={`QR kóði fyrir söngstund ${code}`} width={size} height={size} style={{ borderRadius: 10, display: "block", maxWidth: "100%", height: "auto" }} />;
}

/* Full-screen QR for holding the phone up to the room mid-song. */
function QROverlay({ code, vanitySlug, onClose }) {
  return (
    <div onClick={onClose} role="button" aria-label="Loka QR kóða" style={{
      position: "fixed", inset: 0, zIndex: 60, background: "rgba(10,7,5,0.94)",
      display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
      gap: 18, padding: 24, cursor: "pointer",
    }}>
      <QRCodeImg code={code} size={Math.min(320, Math.floor(window.innerWidth * 0.75))} />
      <div style={{ fontFamily: mono, fontSize: 40, letterSpacing: "0.3em", color: T.amber }}>{code}</div>
      <div style={{ textAlign: "center" }}>
        <div style={{ fontFamily: mono, fontSize: 15, color: T.ink }}>{location.host}/s/{code}</div>
        {vanitySlug && (
          <div style={{ fontFamily: mono, fontSize: 15, color: T.dim, marginTop: 4 }}>{location.host}/{vanitySlug}</div>
        )}
      </div>
      <span style={{ color: T.faint, fontSize: 13 }}>Smelltu hvar sem er til að loka</span>
    </div>
  );
}

export default function HostSession({ code, initialBookId, vanitySlug, onExit }) {
  const [books, setBooks] = useState(null);
  const [bookId, setBookId] = useState(initialBookId ?? null);
  const [songs, setSongs] = useState([]);
  const [songId, setSongId] = useState(null);
  const [line, setLine] = useState(0);
  const [auto, setAuto] = useState(false);
  const [secs, setSecs] = useState(6);
  const [showChords, setShowChords] = useState(true);
  const [showQR, setShowQR] = useState(false);
  const [adapted, setAdapted] = useState(null); // flashes when tap-tempo adjusts the speed
  const [beat, setBeat] = useState(0); // bumped on manual advance to restart the auto timer
  const [guests, setGuests] = useState(0);
  const [requests, setRequests] = useState([]);
  const [recovered, setRecovered] = useState(null); // song adopted from the room on resume
  const [offsets, setOffsets] = useState({}); // per-song transposition (semitones)
  const refs = useRef([]);
  const tapsRef = useRef([]);
  const songIdRef = useRef(null);

  const adoptedRef = useRef(false);
  const onRoomMessage = (msg) => {
    if (msg.type === "presence") setGuests(msg.guests ?? 0);
    else if (msg.type === "requests") setRequests(msg.requests ?? []);
    else if (msg.type === "state" && !adoptedRef.current) {
      // First state from the room: if it's mid-song, we're resuming a
      // running session — adopt what the room is showing.
      adoptedRef.current = true;
      if (msg.state?.song && songIdRef.current === null) {
        const id = msg.state.songId ?? "recovered";
        setRecovered({ id, ...msg.state.song });
        setSongId(id);
        setLine(msg.state.line ?? 0);
      }
    }
  };
  const { send, connected } = useHostSocket(code, onRoomMessage);
  useWakeLock(); // the guitarist's phone must not lock mid-song

  const song = songs.find((s) => s.id === songId)
    ?? (recovered && recovered.id === songId ? recovered : null);
  songIdRef.current = songId;
  const offset = offsets[songId] ?? 0;
  const playedLines = song ? transposeLines(song.lines, offset) : null;

  // The session owns its songbook selection so the player can switch
  // books mid-session without ending it.
  useEffect(() => {
    api.get("/api/songbooks")
      .then(({ songbooks }) => { setBooks(songbooks); setBookId((id) => id ?? songbooks[0]?.id); })
      .catch(() => {});
  }, []);
  useEffect(() => {
    if (!bookId) return;
    api.get(`/api/songbooks/${bookId}/songs`)
      .then(({ songs }) => setSongs(songs))
      .catch(() => {});
  }, [bookId]);

  // ── request handling: search the library, Guitarparty, or a pasted URL ──
  const [library, setLibrary] = useState([]);
  const [query, setQuery] = useState("");
  const [gpResults, setGpResults] = useState(null);
  const [busySearch, setBusySearch] = useState(false);
  const [searchErr, setSearchErr] = useState("");

  useEffect(() => {
    api.get("/api/songs").then(({ songs }) => setLibrary(songs)).catch(() => {});
  }, []);
  useEffect(() => { setGpResults(null); setSearchErr(""); }, [query]);

  const isUrl = /^https?:\/\//i.test(query.trim());
  const q = normalize(query.trim());
  const localMatches = q && !isUrl
    ? library.filter((s) => normalize(`${s.title} ${s.author}`).includes(q)).slice(0, 12)
    : [];

  const playSong = (id) => { setSongId(id); setLine(0); setQuery(""); };

  // Library song that may not be in the current book yet: link it in,
  // refresh the book, start playing.
  const playFromLibrary = async (s) => {
    try {
      if (!songs.find((x) => x.id === s.id)) {
        await api.post(`/api/songbooks/${bookId}/songs`, { songId: s.id });
        const { songs: fresh } = await api.get(`/api/songbooks/${bookId}/songs`);
        setSongs(fresh);
      }
      playSong(s.id);
    } catch (e) { setSearchErr(e.message); }
  };

  const importAndPlay = async (payload) => {
    setBusySearch(true); setSearchErr("");
    try {
      const { songs: imported } = await api.post("/api/import", { songbookId: bookId, ...payload });
      const { songs: fresh } = await api.get(`/api/songbooks/${bookId}/songs`);
      setSongs(fresh);
      api.get("/api/songs").then(({ songs }) => setLibrary(songs)).catch(() => {});
      playSong(imported[0].id);
    } catch (e) { setSearchErr(e.message); }
    setBusySearch(false);
  };

  // Guest requests: a URL imports and plays in one tap; free text drops
  // into the search box so the player picks the right match.
  const acceptRequest = (r) => {
    send({ type: "request_done", id: r.id });
    if (/^https?:\/\//i.test(r.text.trim())) importAndPlay({ url: r.text.trim() });
    else setQuery(r.text);
  };
  const dismissRequest = (r) => send({ type: "request_done", id: r.id });

  const bumpOffset = (d) => {
    if (!songId) return;
    setOffsets((o) => {
      const next = Math.max(-11, Math.min(11, (o[songId] ?? 0) + d));
      return { ...o, [songId]: next };
    });
  };

  const searchGuitarparty = async () => {
    setBusySearch(true); setSearchErr("");
    try {
      const { results } = await api.get(`/api/gp-search?q=${encodeURIComponent(query.trim())}`);
      setGpResults(results);
    } catch (e) { setSearchErr(e.message); }
    setBusySearch(false);
  };

  // First line after `from` that has lyrics (same rule the autoscroll uses).
  const nextLyric = (from) => {
    if (!song) return from;
    let n = from + 1;
    while (n < song.lines.length && !song.lines[n].t) n++;
    return n < song.lines.length ? n : from;
  };

  /* Manual advance with tap-tempo: advancing to the very next lyric line
     2–3 times in a row teaches the autoscroll your pace. */
  const advanceTo = (n) => {
    const now = Date.now();
    const consecutive = song && n !== line && n === nextLyric(line);
    setLine(n);
    setBeat((b) => b + 1);
    if (!consecutive) { tapsRef.current = [now]; return; }
    const taps = [...tapsRef.current.filter((t) => now - t < 30000).slice(-3), now];
    tapsRef.current = taps;
    const intervals = [];
    for (let i = 1; i < taps.length; i++) intervals.push((taps[i] - taps[i - 1]) / 1000);
    const usable = intervals.filter((s) => s >= 2 && s <= 20).slice(-2);
    if (usable.length >= 2) {
      const s = Math.max(3, Math.min(12, Math.round(usable.reduce((a, b) => a + b) / usable.length)));
      setSecs(s);
      setAdapted(s);
      setTimeout(() => setAdapted(null), 2200);
    }
  };

  // Push state to the room whenever it changes (and on reconnect). The
  // pushed lines are transposed, so guests see the played key.
  const lineRef = useRef(0);
  lineRef.current = line;
  useEffect(() => {
    if (!connected || !song) return;
    send({ type: "select_song", songId: song.id, song: { title: song.title, author: song.author, lines: playedLines } });
    if (lineRef.current) send({ type: "set_line", line: lineRef.current });
  }, [connected, songId, offset]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (connected && song) send({ type: "set_line", line }); }, [connected, line]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!auto || !song) return;
    // `beat` restarts the timer on every manual advance, so the next
    // automatic step is measured from the guitarist's last tap.
    const t = setInterval(() => {
      setLine((l) => {
        let n = l + 1;
        while (n < song.lines.length && !song.lines[n].t) n++;
        return n < song.lines.length ? n : l;
      });
    }, secs * 1000);
    return () => clearInterval(t);
  }, [auto, secs, song, beat]);

  useEffect(() => { refs.current[line]?.scrollIntoView({ block: "center", behavior: "smooth" }); }, [line]);

  const endSession = async () => {
    send({ type: "end" });
    try { await api.del(`/api/sessions/${code}`); } catch {}
    onExit();
  };

  const joinUrl = `${location.host}/s/${code}`;

  if (!song) {
    return (
      <div style={{ flex: 1, maxWidth: 560, width: "100%", margin: "0 auto", padding: "22px 24px 60px" }}>
        <button onClick={endSession} style={{ ...btnBase, background: "none", border: "none", color: T.faint, padding: 0 }}>← Loka söngstund</button>
        <h2 style={{ fontSize: 26, fontWeight: 500, margin: "18px 0 4px" }}>
          Söngstund í gangi
          {!connected && <span style={{ color: T.red, fontSize: 14, marginLeft: 10 }}>· tengist…</span>}
        </h2>
        <p style={{ marginBottom: 14 }}>
          <Tag color={guests > 0 ? T.live : T.faint}>{guests > 0 ? `♪ ${guests} syngja með` : "enginn gestur enn"}</Tag>
        </p>

        {requests.length > 0 && (
          <div style={{ background: T.surface, border: `1px solid ${T.amberDeep}`, borderRadius: 12, padding: "10px 14px 4px", marginBottom: 14 }}>
            <Tag color={T.amber}>óskalög gesta</Tag>
            {requests.map((r) => (
              <div key={r.id} style={{ display: "flex", alignItems: "center", gap: 8, padding: "9px 0", borderBottom: `1px solid ${T.line}` }}>
                <span style={{ flex: 1, fontSize: 15, wordBreak: "break-word", minWidth: 0 }}>{r.text}</span>
                <button onClick={() => acceptRequest(r)} disabled={busySearch} style={{
                  ...btnBase, background: T.amber, color: "#221708", fontWeight: 600,
                  padding: "7px 12px", fontSize: 13, borderColor: T.amber, flexShrink: 0,
                }}>{/^https?:\/\//i.test(r.text.trim()) ? "Sækja og spila" : "Leita"}</button>
                <button onClick={() => dismissRequest(r)} aria-label="Hafna ósk"
                  style={{ ...btnBase, background: "none", border: "none", color: T.faint, padding: "4px 6px", flexShrink: 0 }}>✕</button>
              </div>
            ))}
          </div>
        )}
        <div style={{ display: "flex", gap: 18, alignItems: "center", background: T.surface, border: `1px solid ${T.line}`, borderRadius: 14, padding: 18, marginBottom: 22, flexWrap: "wrap" }}>
          <QRCodeImg code={code} />
          <div>
            <Tag>kóði</Tag>
            <div style={{ fontFamily: mono, fontSize: 30, letterSpacing: "0.25em", color: T.amber, margin: "2px 0 10px" }}>{code}</div>
            <Tag>slóð</Tag>
            <div style={{ fontFamily: mono, fontSize: 13, color: T.dim, wordBreak: "break-all" }}>{joinUrl}</div>
            {vanitySlug && (
              <>
                <div style={{ marginTop: 10 }}><Tag>föst slóð</Tag></div>
                <div style={{ fontFamily: mono, fontSize: 13, color: T.dim, wordBreak: "break-all" }}>{location.host}/{vanitySlug}</div>
              </>
            )}
          </div>
        </div>
        <input value={query} onChange={(e) => setQuery(e.target.value)}
          placeholder="Leita að lagi … eða líma slóð"
          aria-label="Leita að lagi eða líma vefslóð"
          style={{ background: T.surface, border: `1px solid ${T.line}`, borderRadius: 10, color: T.ink, padding: "12px 15px", fontSize: 16, width: "100%", font: "inherit", marginBottom: 14 }} />

        {searchErr && <p style={{ color: T.red, fontSize: 14, marginBottom: 12 }}>{searchErr}</p>}

        {q ? (
          <div>
            {isUrl ? (
              <Btn primary disabled={busySearch} onClick={() => importAndPlay({ url: query.trim() })} style={{ width: "100%" }}>
                {busySearch ? "Sæki og greini…" : "Sækja lag af slóðinni og spila"}
              </Btn>
            ) : (
              <>
                {localMatches.length > 0 && <Tag>úr safninu þínu</Tag>}
                {localMatches.map((s) => (
                  <button key={s.id} onClick={() => playFromLibrary(s)} style={{
                    ...btnBase, display: "block", width: "100%", textAlign: "left",
                    background: T.surface, color: T.ink, padding: "13px 15px", margin: "8px 0", fontSize: 16,
                  }}>{s.title}<span style={{ color: T.dim, fontSize: 13, display: "block" }}>{s.author || s.source}</span></button>
                ))}
                {q.length >= 2 && gpResults === null && (
                  <Btn disabled={busySearch} onClick={searchGuitarparty} style={{ width: "100%", marginTop: 8 }}>
                    {busySearch ? "Leita…" : "Leita á Guitarparty ↗"}
                  </Btn>
                )}
                {gpResults?.length === 0 && <p style={{ color: T.faint, fontSize: 14, marginTop: 10 }}>Ekkert fannst á Guitarparty.</p>}
                {gpResults?.length > 0 && (
                  <div style={{ marginTop: 10 }}>
                    <Tag color={T.amberDeep}>guitarparty.com</Tag>
                    {gpResults.map((s) => (
                      <button key={s.id} disabled={busySearch} onClick={() => importAndPlay({ gpId: s.id })} style={{
                        ...btnBase, display: "block", width: "100%", textAlign: "left",
                        background: T.surface, color: T.ink, padding: "13px 15px", margin: "8px 0", fontSize: 16, opacity: busySearch ? 0.6 : 1,
                      }}>{s.title}<span style={{ color: T.dim, fontSize: 13, display: "block" }}>{s.author}</span></button>
                    ))}
                  </div>
                )}
              </>
            )}
          </div>
        ) : (
          <>
            <div style={{ display: "flex", gap: 10, alignItems: "center", marginBottom: 14 }}>
              <p style={{ color: T.dim, fontSize: 15, flexShrink: 0 }}>Veldu lag:</p>
              {books && books.length > 1 && (
                <select value={bookId ?? ""} onChange={(e) => setBookId(e.target.value)} aria-label="Velja söngbók"
                  style={{ background: T.surface, color: T.ink, border: `1px solid ${T.line}`, borderRadius: 8, padding: "8px 10px", font: "inherit", fontSize: 14, flex: 1, minWidth: 0 }}>
                  {books.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
                </select>
              )}
            </div>
            {songs.length === 0 && books && (
              <p style={{ color: T.faint, fontSize: 14, padding: "16px 0" }}>Þessi söngbók er tóm — veldu aðra eða leitaðu að lagi.</p>
            )}
            {songs.map((s) => (
              <button key={s.id} onClick={() => { setSongId(s.id); setLine(0); }} style={{
                ...btnBase, display: "block", width: "100%", textAlign: "left",
                background: T.surface, color: T.ink, padding: "15px 17px", marginBottom: 10, fontSize: 17,
              }}>{s.title}<span style={{ color: T.dim, fontSize: 13, display: "block" }}>{s.author || s.source}</span></button>
            ))}
          </>
        )}
      </div>
    );
  }

  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", maxWidth: 640, width: "100%", margin: "0 auto" }}>
      <div style={{ padding: "18px 24px 8px" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <button onClick={() => { setSongId(null); setAuto(false); }} style={{ ...btnBase, background: "none", border: "none", color: T.faint, padding: 0 }}>← Lagaval</button>
          <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap", justifyContent: "flex-end" }}>
            {requests.length > 0 && (
              <button onClick={() => { setSongId(null); setAuto(false); }} title="Óskalög bíða"
                style={{ ...btnBase, background: "none", borderColor: T.amberDeep, color: T.amber, padding: "3px 9px", fontSize: 13 }}>
                ♪ {requests.length}
              </button>
            )}
            <span style={{ display: "flex", alignItems: "center", gap: 4, color: T.dim, fontSize: 13 }} title="Tónflutningur">
              <button onClick={() => bumpOffset(-1)} aria-label="Tónflytja niður"
                style={{ ...btnBase, background: "none", color: T.dim, padding: "2px 8px", fontSize: 14 }}>−</button>
              <span style={{ fontFamily: mono, color: offset ? T.amber : T.faint, minWidth: 24, textAlign: "center" }}>
                {offset > 0 ? `+${offset}` : offset < 0 ? offset : "♯♭"}
              </span>
              <button onClick={() => bumpOffset(1)} aria-label="Tónflytja upp"
                style={{ ...btnBase, background: "none", color: T.dim, padding: "2px 8px", fontSize: 14 }}>＋</button>
            </span>
            <label style={{ display: "flex", alignItems: "center", gap: 6, color: T.dim, fontSize: 13, cursor: "pointer" }}>
              <input type="checkbox" checked={showChords} onChange={(e) => setShowChords(e.target.checked)} style={{ accentColor: T.amber }} />
              Hljómar
            </label>
            <button onClick={() => setShowQR(true)} title="Sýna QR kóða" aria-label="Sýna QR kóða fyrir gesti"
              style={{ ...btnBase, background: "none", border: "none", padding: 0, fontFamily: mono, letterSpacing: "0.25em", color: connected ? T.amber : T.faint, fontSize: 15 }}>
              {code} ⊞
            </button>
          </div>
        </div>
        <h2 style={{ fontSize: 22, fontWeight: 500, marginTop: 12 }}>{song.title}</h2>
      </div>

      {showQR && <QROverlay code={code} vanitySlug={vanitySlug} onClose={() => setShowQR(false)} />}

      <div style={{ flex: 1, overflowY: "auto", padding: "10px 24px 150px" }}>
        <SongLines song={{ ...song, lines: playedLines }} current={line} showChords={showChords} onTapLine={advanceTo} refs={refs} />
      </div>

      <div style={{ position: "fixed", bottom: 0, left: 0, right: 0, background: "linear-gradient(transparent, #171310 30%)", padding: "26px 24px 20px" }}>
        <div style={{ maxWidth: 592, margin: "0 auto", display: "flex", gap: 10, alignItems: "center" }}>
          <Btn primary={auto} onClick={() => setAuto((a) => !a)} style={{ flexShrink: 0 }}>
            {auto ? "❚❚" : "▶"} Sjálfvirkt
          </Btn>
          <label style={{ flex: 1, display: "flex", alignItems: "center", gap: 10, color: adapted ? T.amber : T.dim, fontSize: 13, transition: "color .3s", whiteSpace: "nowrap" }}>
            {adapted ? `Hraði ${adapted}s ✓` : "Hraði"}
            <input type="range" min={3} max={12} value={15 - secs} onChange={(e) => setSecs(15 - Number(e.target.value))}
              style={{ flex: 1, accentColor: T.amber }} aria-label="Skrunhraði" />
          </label>
          <Btn onClick={() => advanceTo(nextLyric(line))} style={{ flexShrink: 0, background: T.raised }}>Næsta ↓</Btn>
        </div>
      </div>
    </div>
  );
}
