import { useState, useEffect } from "react";
import { T, mono } from "../theme.js";
import { ErrorText, btnBase } from "../ui.jsx";
import { navigate } from "../router.jsx";
import { api } from "../api.js";

export default function Admin() {
  const [users, setUsers] = useState([]);
  const [sessions, setSessions] = useState([]);
  const [log, setLog] = useState([]);
  const [invites, setInvites] = useState([]);
  const [copied, setCopied] = useState(null);
  const [err, setErr] = useState("");

  useEffect(() => {
    Promise.all([
      api.get("/api/admin/users"),
      api.get("/api/admin/sessions"),
      api.get("/api/admin/import-log"),
      api.get("/api/admin/invites"),
    ]).then(([u, s, l, i]) => {
      setUsers(u.users); setSessions(s.sessions); setLog(l.log); setInvites(i.invites);
    }).catch((e) => setErr(e.message));
  }, []);

  const inviteUrl = (token) => `${location.origin}/signup?invite=${token}`;

  const createInvite = async () => {
    const note = window.prompt("Athugasemd við boðið (valfrjálst — t.d. fyrir hvern það er):") ?? "";
    try {
      const { invite } = await api.post("/api/admin/invites", { note });
      setInvites((cur) => [invite, ...cur]);
      copyInvite(invite.token);
    } catch (e) { setErr(e.message); }
  };

  const copyInvite = async (token) => {
    try {
      await navigator.clipboard.writeText(inviteUrl(token));
      setCopied(token);
      setTimeout(() => setCopied(null), 2500);
    } catch { /* clipboard unavailable — the link is visible in the row */ }
  };

  const revokeInvite = async (token) => {
    try {
      await api.del(`/api/admin/invites/${token}`);
      setInvites((cur) => cur.filter((i) => i.token !== token));
    } catch (e) { setErr(e.message); }
  };

  const setApproval = async (email, approved) => {
    try {
      await api.post("/api/admin/users/approval", { email, approved });
      setUsers((cur) => cur.map((u) => (u.email === email ? { ...u, approved } : u)));
    } catch (e) { setErr(e.message); }
  };

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
        {[["Notendur", users.length], ["Bíða samþykkis", users.filter((u) => !u.approved).length], ["Virkar söngstundir", activeSessions.length]].map(([l, v]) => (
          <div key={l} style={{ background: T.surface, border: `1px solid ${T.line}`, borderRadius: 12, padding: "14px 14px" }}>
            <div style={{ fontSize: 26, color: T.amber, fontWeight: 500 }}>{v}</div>
            <div style={{ color: T.dim, fontSize: 12 }}>{l}</div>
          </div>
        ))}
      </div>

      <h3 style={{ fontSize: 17, fontWeight: 500, marginBottom: 8 }}>Notendur</h3>
      <div style={{ overflowX: "auto", background: T.surface, border: `1px solid ${T.line}`, borderRadius: 12, marginBottom: 26 }}>
        <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 560 }}>
          <thead><tr><th style={th}>Netfang</th><th style={th}>Staða</th><th style={th}>Slóð</th><th style={th}>Lög</th><th style={th}>Stundir</th><th style={th}></th></tr></thead>
          <tbody>{users.map((u) => (
            <tr key={u.email}>
              <td style={td}>{u.email}</td>
              <td style={{ ...td, color: u.approved ? T.live : T.amber }}>{u.approved ? "samþykktur" : "bíður"}</td>
              <td style={{ ...td, fontFamily: mono, fontSize: 12 }}>{u.vanity_slug ? `/p/${u.vanity_slug}` : "—"}</td>
              <td style={td}>{u.songs}</td>
              <td style={td}>{u.sessions}</td>
              <td style={{ ...td, textAlign: "right" }}>
                {!u.is_admin && (
                  <button onClick={() => setApproval(u.email, !u.approved)} style={{
                    ...btnBase, padding: "6px 12px", fontSize: 13,
                    background: u.approved ? "none" : T.amber,
                    color: u.approved ? T.red : "#221708",
                    borderColor: u.approved ? "#5A3730" : T.amber,
                    fontWeight: u.approved ? 400 : 600,
                  }}>{u.approved ? "Afturkalla" : "Samþykkja"}</button>
                )}
              </td>
            </tr>
          ))}</tbody>
        </table>
      </div>

      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
        <h3 style={{ fontSize: 17, fontWeight: 500 }}>Boð</h3>
        <button onClick={createInvite} style={{ ...btnBase, background: T.amber, color: "#221708", fontWeight: 600, padding: "8px 14px", fontSize: 13, borderColor: T.amber }}>＋ Nýtt boð</button>
      </div>
      <p style={{ color: T.faint, fontSize: 13, marginBottom: 10 }}>
        Sendu hlekkinn til þess sem á að fá aðgang — skráning í gegnum hann virkjast strax, ekkert samþykki þarf. Hvert boð gildir einu sinni.
      </p>
      <div style={{ background: T.surface, border: `1px solid ${T.line}`, borderRadius: 12, marginBottom: 26, padding: "2px 12px" }}>
        {invites.length === 0 && <p style={{ color: T.faint, fontSize: 14, padding: "12px 2px" }}>Engin boð enn.</p>}
        {invites.map((i) => (
          <div key={i.token} style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 2px", borderBottom: `1px solid ${T.line}` }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontFamily: mono, fontSize: 12, color: i.used_at ? T.faint : T.ink, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {inviteUrl(i.token)}
              </div>
              <div style={{ color: T.faint, fontSize: 12 }}>
                {i.note && <span>{i.note} · </span>}
                {i.used_at
                  ? <span style={{ color: T.live }}>notað{i.used_by_email ? ` af ${i.used_by_email}` : ""}</span>
                  : "ónotað"}
              </div>
            </div>
            {!i.used_at && (
              <>
                <button onClick={() => copyInvite(i.token)} style={{ ...btnBase, background: "none", color: copied === i.token ? T.live : T.dim, padding: "6px 11px", fontSize: 13, flexShrink: 0 }}>
                  {copied === i.token ? "Afritað ✓" : "Afrita"}
                </button>
                <button onClick={() => revokeInvite(i.token)} aria-label="Afturkalla boð"
                  style={{ ...btnBase, background: "none", border: "none", color: T.red, padding: "4px 6px", flexShrink: 0 }}>✕</button>
              </>
            )}
          </div>
        ))}
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
