import { useState, useEffect, useRef } from "react";
import { T } from "../theme.js";
import { Tag, SongLines, btnBase } from "../ui.jsx";
import { navigate } from "../router.jsx";
import { roomSocketUrl } from "../api.js";
import { useWakeLock } from "../wakelock.js";

export default function Guest({ code, cohostKey }) {
  const [state, setState] = useState(null);
  const [status, setStatus] = useState("connecting"); // connecting | live | lost | ended | notfound
  const [showChords, setShowChords] = useState(false);
  const [reqOpen, setReqOpen] = useState(false);
  const [reqText, setReqText] = useState("");
  const [reqNote, setReqNote] = useState(null); // "sent" | error text
  const [isCohost, setIsCohost] = useState(false);
  const [songlist, setSonglist] = useState([]);
  const [next, setNext] = useState(null);
  const [listOpen, setListOpen] = useState(false);
  const refs = useRef([]);
  const wsRef = useRef(null);
  // Guests read along without touching the screen — keep it awake while live.
  useWakeLock(status === "live");

  useEffect(() => {
    let closed = false, retry, ws;
    let failures = 0;
    const connect = () => {
      if (closed) return;
      ws = new WebSocket(roomSocketUrl(code, { key: cohostKey ?? undefined }));
      wsRef.current = ws;
      ws.onopen = () => { failures = 0; setStatus("live"); };
      ws.onmessage = (e) => {
        if (e.data === "pong") return;
        let msg; try { msg = JSON.parse(e.data); } catch { return; }
        if (msg.type === "state") setState(msg.state);
        if (msg.type === "role") setIsCohost(msg.role === "cohost");
        if (msg.type === "songlist") setSonglist(msg.songs ?? []);
        if (msg.type === "next") setNext(msg.next);
        if (msg.type === "ended") { setStatus("ended"); closed = true; }
        if (msg.type === "request_ok") {
          setReqNote("sent");
          setReqText("");
          setTimeout(() => { setReqNote(null); setReqOpen(false); }, 2500);
        }
        if (msg.type === "request_err") setReqNote(msg.message ?? "Tókst ekki — reyndu aftur.");
      };
      ws.onclose = () => {
        if (closed) return;
        failures++;
        setStatus(failures >= 3 ? "notfound" : "lost");
        if (failures < 20) retry = setTimeout(connect, 3000);
      };
      ws.onerror = () => ws.close();
    };
    connect();
    const ping = setInterval(() => { if (ws?.readyState === WebSocket.OPEN) ws.send("ping"); }, 20000);
    return () => { closed = true; clearInterval(ping); clearTimeout(retry); ws?.close(); };
  }, [code, cohostKey]);

  const sendCtl = (msg) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) wsRef.current.send(JSON.stringify(msg));
  };
  const cohostNextLine = () => {
    if (!state?.song) return;
    let n = state.line + 1;
    while (n < state.song.lines.length && !state.song.lines[n].t) n++;
    if (n < state.song.lines.length) sendCtl({ type: "set_line", line: n });
  };

  const sendRequest = () => {
    const text = reqText.trim();
    if (!text || wsRef.current?.readyState !== WebSocket.OPEN) return;
    setReqNote(null);
    wsRef.current.send(JSON.stringify({ type: "request", text }));
  };

  useEffect(() => {
    if (state?.song) refs.current[state.line]?.scrollIntoView({ block: "center", behavior: "smooth" });
  }, [state?.line, state?.song?.title]);

  const live = status === "live";

  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", maxWidth: 560, width: "100%", margin: "0 auto" }}>
      <div style={{ padding: "18px 24px 6px", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <button onClick={() => navigate("/")} style={{ ...btnBase, background: "none", border: "none", color: T.faint, fontSize: 14, padding: 0 }}>← Hætta</button>
        <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
          <label style={{ display: "flex", alignItems: "center", gap: 6, color: T.dim, fontSize: 13, cursor: "pointer" }}>
            <input type="checkbox" checked={showChords} onChange={(e) => setShowChords(e.target.checked)} style={{ accentColor: T.amber }} />
            Hljómar
          </label>
          <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
            {isCohost && <Tag color={T.amber}>forsöngvari</Tag>}
            <span style={{ width: 8, height: 8, borderRadius: "50%", background: live ? T.live : T.faint, animation: live ? "pulse 2s infinite" : "none" }} />
            <Tag color={live ? T.live : T.faint}>{live ? code : "samband rofið"}</Tag>
          </span>
        </div>
      </div>

      {status === "ended" ? (
        <div style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: 24, textAlign: "center" }}>
          <div style={{ fontSize: 40, marginBottom: 14 }}>♪</div>
          <p style={{ color: T.dim, fontSize: 16, maxWidth: 300, lineHeight: 1.5 }}>
            Söngstundinni er lokið — takk fyrir að syngja með!
          </p>
        </div>
      ) : status === "notfound" && !state ? (
        <div style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: 24, textAlign: "center" }}>
          <div style={{ fontSize: 40, marginBottom: 14 }}>♪</div>
          <p style={{ color: T.dim, fontSize: 16, maxWidth: 300, lineHeight: 1.5 }}>
            Engin söngstund fannst með kóðann <b style={{ color: T.amber }}>{code}</b> — athugaðu kóðann og reyndu aftur.
          </p>
        </div>
      ) : !state?.song ? (
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
          <SongLines song={state.song} current={state.line} showChords={showChords} refs={refs} dimPast
            onTapLine={isCohost ? (i) => sendCtl({ type: "set_line", line: i }) : undefined} />
        </div>
      )}

      {status === "live" && isCohost ? (
        <div style={{ position: "fixed", bottom: 0, left: 0, right: 0, background: "linear-gradient(transparent, #171310 45%)", padding: "22px 20px calc(14px + env(safe-area-inset-bottom))" }}>
          <div style={{ maxWidth: 520, margin: "0 auto" }}>
            {listOpen && (
              <div style={{ background: T.surface, border: `1px solid ${T.line}`, borderRadius: 12, marginBottom: 10, maxHeight: "45vh", overflowY: "auto", padding: "4px 12px" }}>
                {songlist.length === 0 && <p style={{ color: T.faint, fontSize: 14, padding: "10px 2px" }}>Engin lög enn.</p>}
                {songlist.map((s) => (
                  <div key={s.id} style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 0", borderBottom: `1px solid ${T.line}` }}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 15, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{s.title}</div>
                      <div style={{ color: T.dim, fontSize: 12 }}>{s.author}</div>
                    </div>
                    {next?.songId === s.id ? (
                      <span style={{ color: T.live, fontSize: 12, flexShrink: 0 }}>næst ✓</span>
                    ) : (
                      <button onClick={() => sendCtl({ type: "queue_song", songId: s.id })}
                        style={{ ...btnBase, background: "none", color: T.amber, borderColor: T.amberDeep, padding: "6px 11px", fontSize: 12, flexShrink: 0 }}>Setja næst</button>
                    )}
                  </div>
                ))}
              </div>
            )}
            {next && (
              <div style={{ display: "flex", alignItems: "center", gap: 10, background: T.surface, border: `1px solid ${T.line}`, borderRadius: 12, padding: "8px 12px", marginBottom: 10 }}>
                <span style={{ flex: 1, fontSize: 13, color: T.dim, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  Næst: <b style={{ color: T.ink }}>{next.title}</b>
                </span>
                <button onClick={() => sendCtl({ type: "play_next" })}
                  style={{ ...btnBase, background: T.amber, color: "#221708", fontWeight: 600, padding: "7px 12px", fontSize: 13, borderColor: T.amber, flexShrink: 0 }}>▶ Spila</button>
              </div>
            )}
            <div style={{ display: "flex", gap: 10 }}>
              <button onClick={() => setListOpen((o) => !o)} style={{
                ...btnBase, flex: 1, background: listOpen ? T.raised : "rgba(36,29,24,0.9)", color: T.dim, padding: "11px 14px", fontSize: 14,
              }}>♪ Lög</button>
              <button onClick={cohostNextLine} disabled={!state?.song} style={{
                ...btnBase, flex: 2, background: T.raised, color: T.ink, padding: "11px 14px", fontSize: 15, opacity: state?.song ? 1 : 0.5,
              }}>Næsta ↓</button>
            </div>
          </div>
        </div>
      ) : status === "live" && (
        <div style={{ position: "fixed", bottom: 0, left: 0, right: 0, background: "linear-gradient(transparent, #171310 55%)", padding: "22px 20px calc(14px + env(safe-area-inset-bottom))" }}>
          <div style={{ maxWidth: 520, margin: "0 auto" }}>
            {reqOpen ? (
              <div>
                <div style={{ display: "flex", gap: 8 }}>
                  <input value={reqText} onChange={(e) => setReqText(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && sendRequest()}
                    placeholder="Lag, flytjandi … eða guitarparty-slóð"
                    aria-label="Óskalag"
                    style={{ background: T.surface, border: `1px solid ${T.line}`, borderRadius: 10, color: T.ink, padding: "11px 13px", fontSize: 16, flex: 1, font: "inherit", minWidth: 0 }} />
                  <button onClick={sendRequest} disabled={!reqText.trim()} style={{
                    ...btnBase, background: T.amber, color: "#221708", fontWeight: 600,
                    padding: "11px 15px", fontSize: 14, borderColor: T.amber, flexShrink: 0,
                    opacity: reqText.trim() ? 1 : 0.5,
                  }}>Senda</button>
                  <button onClick={() => { setReqOpen(false); setReqNote(null); }} aria-label="Hætta við ósk"
                    style={{ ...btnBase, background: "none", border: "none", color: T.faint, padding: "0 4px", flexShrink: 0 }}>✕</button>
                </div>
                {reqNote && (
                  <p style={{ color: reqNote === "sent" ? T.live : T.red, fontSize: 13, marginTop: 8, textAlign: "center" }}>
                    {reqNote === "sent" ? "Óskin er komin til gítarleikarans ♪" : reqNote}
                  </p>
                )}
              </div>
            ) : (
              <button onClick={() => setReqOpen(true)} style={{
                ...btnBase, display: "block", margin: "0 auto", background: "rgba(36,29,24,0.9)",
                color: T.dim, padding: "9px 18px", fontSize: 14,
              }}>♪ Óska eftir lagi</button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
