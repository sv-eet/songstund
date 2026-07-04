import { useState, useEffect, useRef, useCallback } from "react";
import { T, mono } from "../theme.js";
import { Tag, Btn, SongLines, btnBase } from "../ui.jsx";
import { api, roomSocketUrl } from "../api.js";
import { useWakeLock } from "../wakelock.js";

function useHostSocket(code) {
  const wsRef = useRef(null);
  const [connected, setConnected] = useState(false);
  const closedRef = useRef(false);

  useEffect(() => {
    closedRef.current = false;
    let retry;
    const connect = () => {
      if (closedRef.current) return;
      const ws = new WebSocket(roomSocketUrl(code, true));
      wsRef.current = ws;
      ws.onopen = () => setConnected(true);
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

export default function HostSession({ code, songs, vanitySlug, onExit }) {
  const [songId, setSongId] = useState(null);
  const [line, setLine] = useState(0);
  const [auto, setAuto] = useState(false);
  const [secs, setSecs] = useState(6);
  const [showChords, setShowChords] = useState(true);
  const [showQR, setShowQR] = useState(false);
  const [adapted, setAdapted] = useState(null); // flashes when tap-tempo adjusts the speed
  const [beat, setBeat] = useState(0); // bumped on manual advance to restart the auto timer
  const song = songs.find((s) => s.id === songId);
  const refs = useRef([]);
  const tapsRef = useRef([]);
  const { send, connected } = useHostSocket(code);
  useWakeLock(); // the guitarist's phone must not lock mid-song

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

  // Push state to the room whenever it changes (and on reconnect).
  useEffect(() => {
    if (!connected) return;
    if (song) send({ type: "select_song", songId: song.id, song: { title: song.title, author: song.author, lines: song.lines } });
    else send({ type: "clear_song" });
  }, [connected, songId]); // eslint-disable-line react-hooks/exhaustive-deps
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
        <h2 style={{ fontSize: 26, fontWeight: 500, margin: "18px 0 14px" }}>
          Söngstund í gangi
          {!connected && <span style={{ color: T.red, fontSize: 14, marginLeft: 10 }}>· tengist…</span>}
        </h2>
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
        <SongLines song={song} current={line} showChords={showChords} onTapLine={advanceTo} refs={refs} />
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
