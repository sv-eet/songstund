import { useState } from "react";
import { T } from "../theme.js";
import { Tag, Btn, Input, ErrorText, btnBase } from "../ui.jsx";
import { navigate } from "../router.jsx";
import { authClient } from "../auth.js";
import { api } from "../api.js";

export default function Login({ signup = false }) {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [pw, setPw] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const invite = new URLSearchParams(window.location.search).get("invite");
  const ok = email.includes("@") && pw.length >= 8 && (!signup || name.trim());

  const submit = async () => {
    if (!ok || busy) return;
    setBusy(true); setErr("");
    const { error } = signup
      ? await authClient.signUp.email({ email, password: pw, name: name.trim() })
      : await authClient.signIn.email({ email, password: pw });
    if (error) {
      setBusy(false);
      setErr(signup
        ? (error.status === 422 ? "Netfangið er þegar skráð." : "Nýskráning tókst ekki — athugaðu netfang og lykilorð (minnst 8 stafir).")
        : "Innskráning tókst ekki — rangt netfang eða lykilorð.");
      return;
    }
    if (invite) {
      // Redeem the invite: activates the account immediately, no approval
      // wait. Hard redirect so the session (with approved=true) reloads.
      try { await api.post("/api/invites/redeem", { token: invite }); } catch {}
      window.location.assign("/app");
      return;
    }
    navigate("/app");
  };

  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", justifyContent: "center", padding: 24, maxWidth: 420, width: "100%", margin: "0 auto" }}>
      <Tag color={T.amber}>söngstund · samskiptalausnir.is</Tag>
      <h1 style={{ fontSize: 38, fontWeight: 500, margin: "10px 0 4px" }}>{signup ? "Nýskráning" : "Spilarasvæði"}</h1>
      <p style={{ color: T.dim, marginBottom: 28, lineHeight: 1.5 }}>
        {signup
          ? "Búðu til aðgang til að halda utan um söngbókina þína."
          : "Skráðu þig inn til að halda utan um söngbókina þína og hefja söngstund."}
      </p>
      {invite && (
        <p style={{ color: T.live, fontSize: 14, marginBottom: 18, marginTop: -14 }}>
          ✓ Þú ert með boð — aðgangurinn þinn virkjast strax við skráningu.
        </p>
      )}
      <div style={{ display: "grid", gap: 10 }}>
        {signup && <Input placeholder="Nafn" value={name} onChange={(e) => setName(e.target.value)} />}
        <Input placeholder="Netfang" type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
        <Input placeholder="Lykilorð (minnst 8 stafir)" type="password" value={pw} onChange={(e) => setPw(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && submit()} />
        <Btn primary disabled={!ok || busy} onClick={submit} style={{ opacity: ok && !busy ? 1 : 0.5 }}>
          {busy ? "Augnablik…" : signup ? "Stofna aðgang" : "Skrá inn"}
        </Btn>
        <ErrorText>{err}</ErrorText>
      </div>
      <p style={{ color: T.faint, fontSize: 14, marginTop: 16 }}>
        {signup ? "Áttu þegar aðgang? " : "Vantar þig aðgang? "}
        <button onClick={() => navigate((signup ? "/login" : "/signup") + window.location.search)}
          style={{ ...btnBase, background: "none", border: "none", color: T.amber, padding: 0, fontSize: 14 }}>
          {signup ? "Skrá inn" : "Nýskráning"}
        </button>
      </p>
    </div>
  );
}
