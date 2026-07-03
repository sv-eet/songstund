import { useState, useRef } from "react";
import { T, mono } from "../theme.js";
import { Btn, Input, ErrorText, btnBase } from "../ui.jsx";
import { api } from "../api.js";

export default function ImportModal({ songbookId, onClose, onAdded }) {
  const [tab, setTab] = useState("paste");
  const [title, setTitle] = useState("");
  const [author, setAuthor] = useState("");
  const [text, setText] = useState("");
  const [url, setUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const fileRef = useRef(null);

  const submit = async (payload) => {
    setBusy(true); setErr("");
    try {
      const { song } = await api.post("/api/import", {
        songbookId, title: title.trim(), author: author.trim(), ...payload,
      });
      onAdded(song);
      onClose();
    } catch (e) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  };

  const onPdf = async (file) => {
    if (!file) return;
    setBusy(true); setErr("");
    try {
      const { extractPdfText } = await import("../pdf.js");
      const pdfText = await extractPdfText(file);
      await submit({ pdfText, filename: file.name });
    } catch {
      setErr("Gat ekki lesið PDF-skjalið.");
      setBusy(false);
    }
  };

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(10,7,5,0.75)", display: "flex", alignItems: "flex-end", justifyContent: "center", zIndex: 50 }}
      onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()} style={{
        background: T.surface, borderRadius: "18px 18px 0 0", width: "100%", maxWidth: 560,
        maxHeight: "88vh", overflowY: "auto", padding: "20px 22px 30px", border: `1px solid ${T.line}`,
      }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
          <h3 style={{ fontSize: 20, fontWeight: 500 }}>Bæta lagi í söngbók</h3>
          <button onClick={onClose} style={{ ...btnBase, background: "none", color: T.dim, padding: "6px 12px" }}>✕</button>
        </div>
        <div style={{ display: "flex", gap: 8, marginBottom: 18 }}>
          {[["paste", "Líma texta"], ["url", "Vefslóð"], ["pdf", "PDF"]].map(([k, l]) => (
            <button key={k} onClick={() => { setTab(k); setErr(""); }} style={{
              ...btnBase, padding: "8px 14px", fontSize: 14, flex: 1,
              background: tab === k ? T.raised : "none",
              color: tab === k ? T.amber : T.dim,
              borderColor: tab === k ? T.amberDeep : T.line,
            }}>{l}</button>
          ))}
        </div>

        {tab !== "url" && (
          <div style={{ display: "grid", gap: 10, marginBottom: 10 }}>
            <Input placeholder="Titill" value={title} onChange={(e) => setTitle(e.target.value)} />
            <Input placeholder="Höfundur (valfrjálst)" value={author} onChange={(e) => setAuthor(e.target.value)} />
          </div>
        )}

        {tab === "paste" && (
          <div style={{ display: "grid", gap: 10 }}>
            <textarea value={text} onChange={(e) => setText(e.target.value)}
              placeholder={"Límdu hljómablað hér — parserinn þekkir hljómalínur sjálfkrafa:\n\nC        G\nDæmi um línu með hljómum yfir texta"}
              rows={9} style={{
                background: T.bg, border: `1px solid ${T.line}`, borderRadius: 10, color: T.ink,
                padding: 14, fontFamily: mono, fontSize: 13, width: "100%", resize: "vertical",
              }} />
            <Btn primary disabled={!text.trim() || busy} onClick={() => submit({ pasted: text })}
              style={{ opacity: text.trim() && !busy ? 1 : 0.5 }}>{busy ? "Greini…" : "Greina og vista"}</Btn>
          </div>
        )}

        {tab === "url" && (
          <div style={{ display: "grid", gap: 10 }}>
            <Input placeholder="https://www.guitarparty.com/lag/…" value={url} onChange={(e) => setUrl(e.target.value)} />
            <Input placeholder="Titill (valfrjálst — annars lesinn af síðunni)" value={title} onChange={(e) => setTitle(e.target.value)} />
            <Input placeholder="Höfundur (valfrjálst)" value={author} onChange={(e) => setAuthor(e.target.value)} />
            <Btn primary disabled={!url.trim() || busy} onClick={() => submit({ url: url.trim() })}
              style={{ opacity: url.trim() && !busy ? 1 : 0.5 }}>{busy ? "Sæki og greini…" : "Sækja lag"}</Btn>
            <p style={{ color: T.faint, fontSize: 13 }}>
              Sækir síðuna, les hljóma og texta úr henni og vistar í söngbókina þína.
            </p>
          </div>
        )}

        {tab === "pdf" && (
          <div style={{ display: "grid", gap: 10 }}>
            <input ref={fileRef} type="file" accept="application/pdf,.pdf" style={{ display: "none" }}
              onChange={(e) => onPdf(e.target.files?.[0])} />
            <div role="button" onClick={() => fileRef.current?.click()}
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => { e.preventDefault(); onPdf(e.dataTransfer.files?.[0]); }}
              style={{ border: `1.5px dashed ${T.line}`, borderRadius: 12, padding: "34px 20px", textAlign: "center", color: T.dim, cursor: "pointer" }}>
              {busy ? "Les PDF og greini…" : "Dragðu PDF hingað eða smelltu til að velja skrá"}
            </div>
            <p style={{ color: T.faint, fontSize: 13 }}>
              Textinn er lesinn úr skjalinu í vafranum þínum. Skannaðar myndir (án texta) fá villu — OCR kemur í næstu útgáfu.
            </p>
          </div>
        )}

        <div style={{ marginTop: 10 }}><ErrorText>{err}</ErrorText></div>
      </div>
    </div>
  );
}
