import { useState } from "react";
import { T } from "../theme.js";
import { Tag, Btn, Input, ErrorText } from "../ui.jsx";
import { navigate } from "../router.jsx";
import { authClient } from "../auth.js";

/* /reset?token=… — landing page for the link in the reset email. */
export default function ResetPassword() {
  const params = new URLSearchParams(window.location.search);
  const token = params.get("token");
  const linkErr = params.get("error");
  const [pw, setPw] = useState("");
  const [pw2, setPw2] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const ok = pw.length >= 8 && pw === pw2;

  const submit = async () => {
    if (!ok || busy) return;
    setBusy(true); setErr("");
    const { error } = await authClient.resetPassword({ newPassword: pw, token });
    setBusy(false);
    if (error) {
      setErr("Endurstillingin tókst ekki — hlekkurinn gæti verið útrunninn. Biddu um nýjan hlekk.");
      return;
    }
    setDone(true);
  };

  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", justifyContent: "center", padding: 24, maxWidth: 420, width: "100%", margin: "0 auto" }}>
      <Tag color={T.amber}>söngstund · samskiptalausnir.is</Tag>
      <h1 style={{ fontSize: 32, fontWeight: 500, margin: "10px 0 4px" }}>Nýtt lykilorð</h1>

      {done ? (
        <>
          <p style={{ color: T.dim, lineHeight: 1.5, margin: "14px 0 24px" }}>
            Lykilorðinu hefur verið breytt — skráðu þig inn með því nýja.
          </p>
          <Btn primary onClick={() => navigate("/login")}>Skrá inn</Btn>
        </>
      ) : !token || linkErr ? (
        <>
          <p style={{ color: T.dim, lineHeight: 1.5, margin: "14px 0 24px" }}>
            Hlekkurinn er ógildur eða útrunninn. Biddu um nýjan á innskráningarsíðunni.
          </p>
          <Btn onClick={() => navigate("/login")}>Á innskráningarsíðu</Btn>
        </>
      ) : (
        <>
          <p style={{ color: T.dim, marginBottom: 24, lineHeight: 1.5 }}>Veldu nýtt lykilorð (minnst 8 stafir).</p>
          <div style={{ display: "grid", gap: 10 }}>
            <Input placeholder="Nýtt lykilorð" type="password" value={pw} onChange={(e) => setPw(e.target.value)} />
            <Input placeholder="Nýtt lykilorð aftur" type="password" value={pw2} onChange={(e) => setPw2(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && submit()} />
            <Btn primary disabled={!ok || busy} onClick={submit} style={{ opacity: ok && !busy ? 1 : 0.5 }}>
              {busy ? "Vista…" : "Vista lykilorð"}
            </Btn>
            {pw2 && pw !== pw2 && <p style={{ color: T.faint, fontSize: 13 }}>Lykilorðin stemma ekki.</p>}
            <ErrorText>{err}</ErrorText>
          </div>
        </>
      )}
    </div>
  );
}
