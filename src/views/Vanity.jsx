import { useState, useEffect } from "react";
import { T } from "../theme.js";
import { Btn } from "../ui.jsx";
import { navigate } from "../router.jsx";
import { api } from "../api.js";

/* /p/{slug} — the Worker 302-redirects straight to /s/{code} when a
   session is live; this page only renders when nothing is active. */
export default function Vanity({ slug }) {
  const [checked, setChecked] = useState(false);

  useEffect(() => {
    api.get(`/api/p/${slug}`)
      .then(({ code }) => (code ? navigate(`/s/${code}`) : setChecked(true)))
      .catch(() => setChecked(true));
  }, [slug]);

  if (!checked) return null;
  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: 24, textAlign: "center" }}>
      <div style={{ fontSize: 40, marginBottom: 14 }}>♪</div>
      <p style={{ color: T.dim, fontSize: 16, maxWidth: 320, lineHeight: 1.5, marginBottom: 24 }}>
        Engin söngstund er í gangi hjá <b style={{ color: T.amber }}>{slug}</b> í augnablikinu.
        Kíktu aftur þegar gítarinn er kominn á loft!
      </p>
      <Btn onClick={() => navigate("/")}>Á forsíðu</Btn>
    </div>
  );
}
