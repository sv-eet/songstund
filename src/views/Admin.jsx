import { useState, useEffect } from "react";
import { T, mono } from "../theme.js";
import { ErrorText, btnBase } from "../ui.jsx";
import { navigate } from "../router.jsx";
import { api } from "../api.js";

export default function Admin() {
  const [users, setUsers] = useState([]);
  const [sessions, setSessions] = useState([]);
  const [log, setLog] = useState([]);
  const [err, setErr] = useState("");

  useEffect(() => {
    Promise.all([
      api.get("/api/admin/users"),
      api.get("/api/admin/sessions"),
      api.get("/api/admin/import-log"),
    ]).then(([u, s, l]) => {
      setUsers(u.users); setSessions(s.sessions); setLog(l.log);
    }).catch((e) => setErr(e.message));
  }, []);

  const th = { textAlign: "left", padding: "8px 10px", color: T.faint, fontFamily: mono, fontSize: 11, letterSpacing: "0.1em", textTransform: "uppercase", borderBottom: `1px solid ${T.line}` };
  const td = { padding: "10px", fontSize: 14, borderBottom: `1px solid ${T.line}` };
  const activeSessions = sessions.filter((s) => !s.ended_at);

  return (
    <div style={{ flex: 1, maxWidth: 720, width: "100%", margin: "0 auto", padding: "22px 24px 60px" }}>
      <button onClick={() => navigate("/app")} style={{ ...btnBase, background: "none", border: "none", color: T.faint, padding: 0 }}>← Til baka</button>
      <h1 style={{ fontSize: 28, fontWeight: 500, margin: "16px 0 4px" }}>Stjórnborð</h1>
      <p style={{ color: T.dim, fontSize: 14, marginBottom: 24 }}>Notendur, söngstundir og innflutningsskrá.</p>
      <ErrorText>{err}</ErrorText>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 10, marginBottom: 26 }}>
        {[["Notendur", users.length], ["Virkar áskriftir", users.filter((u) => u.subscription_status === "active").length], ["Virkar söngstundir", activeSessions.length]].map(([l, v]) => (
          <div key={l} style={{ background: T.surface, border: `1px solid ${T.line}`, borderRadius: 12, padding: "14px 14px" }}>
            <div style={{ fontSize: 26, color: T.amber, fontWeight: 500 }}>{v}</div>
            <div style={{ color: T.dim, fontSize: 12 }}>{l}</div>
          </div>
        ))}
      </div>

      <h3 style={{ fontSize: 17, fontWeight: 500, marginBottom: 8 }}>Notendur</h3>
      <div style={{ overflowX: "auto", background: T.surface, border: `1px solid ${T.line}`, borderRadius: 12, marginBottom: 26 }}>
        <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 480 }}>
          <thead><tr><th style={th}>Netfang</th><th style={th}>Áskrift</th><th style={th}>Slóð</th><th style={th}>Lög</th><th style={th}>Stundir</th></tr></thead>
          <tbody>{users.map((u) => (
            <tr key={u.email}>
              <td style={td}>{u.email}</td>
              <td style={{ ...td, color: u.subscription_status === "active" ? T.live : T.amber }}>{u.subscription_status === "active" ? "virk" : u.subscription_status}</td>
              <td style={{ ...td, fontFamily: mono, fontSize: 12 }}>{u.vanity_slug ? `/p/${u.vanity_slug}` : "—"}</td>
              <td style={td}>{u.songs}</td>
              <td style={td}>{u.sessions}</td>
            </tr>
          ))}</tbody>
        </table>
      </div>

      <h3 style={{ fontSize: 17, fontWeight: 500, marginBottom: 8 }}>Söngstundir</h3>
      <div style={{ overflowX: "auto", background: T.surface, border: `1px solid ${T.line}`, borderRadius: 12, marginBottom: 26 }}>
        <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 430 }}>
          <thead><tr><th style={th}>Kóði</th><th style={th}>Spilari</th><th style={th}>Hófst</th><th style={th}>Staða</th></tr></thead>
          <tbody>{sessions.map((s) => (
            <tr key={s.code + s.created_at}>
              <td style={{ ...td, fontFamily: mono }}>{s.code}</td>
              <td style={td}>{s.email}</td>
              <td style={{ ...td, fontFamily: mono, fontSize: 12 }}>{s.created_at}</td>
              <td style={{ ...td, color: s.ended_at ? T.faint : T.live }}>{s.ended_at ? "lokið" : "í gangi"}</td>
            </tr>
          ))}</tbody>
        </table>
      </div>

      <h3 style={{ fontSize: 17, fontWeight: 500, marginBottom: 8 }}>Innflutningsskrá</h3>
      {log.map((l, i) => (
        <div key={i} style={{ display: "flex", gap: 12, padding: "10px 4px", borderBottom: `1px solid ${T.line}`, fontSize: 14 }}>
          <span style={{ fontFamily: mono, color: T.faint, fontSize: 12, paddingTop: 2, whiteSpace: "nowrap" }}>{l.created_at}</span>
          <span style={{ color: l.ok ? T.dim : T.red, lineHeight: 1.4 }}>
            [{l.kind}] {l.message}{l.email ? ` — ${l.email}` : ""}
          </span>
        </div>
      ))}
      {!log.length && <p style={{ color: T.faint, fontSize: 14 }}>Engar færslur enn.</p>}
    </div>
  );
}
