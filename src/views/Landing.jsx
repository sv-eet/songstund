import { useState } from "react";
import { T, mono } from "../theme.js";
import { Tag, Btn, Input } from "../ui.jsx";
import { navigate } from "../router.jsx";

export default function Landing() {
  const [code, setCode] = useState("");
  const join = () => code.length === 4 && navigate(`/s/${code}`);
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
        <Input value={code} onChange={(e) => setCode(e.target.value.toUpperCase().replace(/[^A-Z]/g, "").slice(0, 4))}
          onKeyDown={(e) => e.key === "Enter" && join()}
          placeholder="KÓÐI" aria-label="Kóði söngstundar"
          style={{ fontFamily: mono, letterSpacing: "0.35em", textAlign: "center", fontSize: 20, flex: 1 }} />
        <Btn onClick={join} disabled={code.length !== 4}
          style={{ background: T.raised, opacity: code.length === 4 ? 1 : 0.6 }}>Syngja með</Btn>
      </div>
      <Btn primary onClick={() => navigate("/login")}>Spilarasvæði — innskráning</Btn>
    </div>
  );
}
