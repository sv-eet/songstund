import { useState, useEffect, useRef } from "react";
import { T } from "../theme.js";
import { Tag, SongLines, btnBase } from "../ui.jsx";
import { navigate } from "../router.jsx";
import { roomSocketUrl } from "../api.js";

export default function Guest({ code }) {
  const [state, setState] = useState(null);
  const [status, setStatus] = useState("connecting"); // connecting | live | lost | ended | notfound
  const [showChords, setShowChords] = useState(false);
  const refs = useRef([]);

  useEffect(() => {
    let closed = false, retry, ws;
    let failures = 0;
    const connect = () => {
      if (closed) return;
      ws = new WebSocket(roomSocketUrl(code));
      ws.onopen = () => { failures = 0; setStatus("live"); };
      ws.onmessage = (e) => {
        if (e.data === "pong") return;
        let msg; try { msg = JSON.parse(e.data); } catch { return; }
        if (msg.type === "state") setState(msg.state);
        if (msg.type === "ended") { setStatus("ended"); closed = true; }
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
  }, [code]);

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
          <SongLines song={state.song} current={state.line} showChords={showChords} refs={refs} dimPast />
        </div>
      )}
    </div>
  );
}
