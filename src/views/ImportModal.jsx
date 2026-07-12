import { useState, useEffect, useRef } from "react";
import { T, mono } from "../theme.js";
import { Btn, Input, ErrorText, btnBase } from "../ui.jsx";
import { api } from "../api.js";

export default function ImportModal({ songbookId, currentIds, onClose, onChanged }) {
  const [tab, setTab] = useState("safn");
  const [title, setTitle] = useState("");
  const [author, setAuthor] = useState("");
  const [text, setText] = useState("");
  const [url, setUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [library, setLibrary] = useState(null);
  const [inBook, setInBook] = useState(() => new Set(currentIds));
  const [gpResults, setGpResults] = useState(null);
  const [gpAdded, setGpAdded] = useState(() => new Set());
  const fileRef = useRef(null);
  const isUrl = /^https?:\/\//i.test(url.trim());

  const loadLibrary = () => {
    api.get("/api/songs")
      .then(({ songs }) => setLibrary(songs))
      .catch((e) => setErr(e.message));
  };
  useEffect(loadLibrary, []);
  useEffect(() => { setGpResults(null); }, [url]);

  const searchGp = async () => {
    setBusy(true); setErr("");
    try {
      const { results } = await api.get(`/api/gp-search?q=${encodeURIComponent(url.trim())}`);
      setGpResults(results);
    } catch (e) { setErr(e.message); }
    setBusy(false);
  };

  // Add a search hit to the songbook without closing the modal — the
  // server reuses an existing library copy if there is one.
  const addGpResult = async (r) => {
    setBusy(true); setErr("");
    try {
      const { songs } = await api.post("/api/import", { songbookId, gpId: r.id });
      setGpAdded((cur) => new Set(cur).add(r.id));
      setInBook((cur) => new Set(cur).add(songs[0].id));
      loadLibrary();
      onChanged();
    } catch (e) { setErr(e.message); }
    setBusy(false);
  };

  const inLibrary = (r) => library?.some((s) => s.source === `guitarparty.com/songs/${r.id}`);

  const submit = async (payload) => {
    setBusy(true); setErr("");
    try {
      await api.post("/api/import", {
        songbookId, title: title.trim(), author: author.trim(), ...payload,
      });
      onChanged();
      onClose();
    } catch (e) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  };

  const addFromLibrary = async (song) => {
    try {
      await api.post(`/api/songbooks/${songbookId}/songs`, { songId: song.id });
      setInBook((cur) => new Set(cur).add(song.id));
      onChanged();
    } catch (e) { setErr(e.message); }
  };

  const deleteFromLibrary = async (song) => {
    if (!window.confirm(`Eyða „${song.title}“ alveg úr safninu? Lagið hverfur úr öllum söngbókum.`)) return;
    try {
      await api.del(`/api/songs/${song.id}`);
      setLibrary((cur) => cur.filter((s) => s.id !== song.id));
      onChanged();
    } catch (e) { setErr(e.message); }
  };

  const onPdf = async (file) => {
    if (!file) return;
    setBusy(true); setErr("");
    try {
      const { extractPdfSongs } = await import("../pdf.js");
      const found = await extractPdfSongs(file);
      if (!found.length) {
        setErr("PDF-skjalið inniheldur engan texta — líklega skönnuð mynd. OCR kemur í næstu útgáfu.");
        setBusy(false);
        return;
      }
      if (found.length > 1 && !window.confirm(`Fann ${found.length} lög í skjalinu — flytja þau öll inn?`)) {
        setBusy(false);
        return;
      }
      // Single generic PDF: let the title/author fields override.
      if (found.length === 1 && !found[0].title) {
        found[0].title = title.trim();
        found[0].author = author.trim() || found[0].author;
      }
      await submit({ pdfSongs: found, filename: file.name });
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
          {[["safn", "Úr safni"], ["paste", "Líma texta"], ["url", "Leita / slóð"], ["pdf", "PDF"]].map(([k, l]) => (
            <button key={k} onClick={() => { setTab(k); setErr(""); }} style={{
              ...btnBase, padding: "8px 12px", fontSize: 14, flex: 1,
              background: tab === k ? T.raised : "none",
              color: tab === k ? T.amber : T.dim,
              borderColor: tab === k ? T.amberDeep : T.line,
            }}>{l}</button>
          ))}
        </div>

        {tab === "safn" && (
          <div>
            {library === null && <p style={{ color: T.faint, fontSize: 14 }}>Sæki safnið …</p>}
            {library?.length === 0 && (
              <p style={{ color: T.faint, fontSize: 14, textAlign: "center", padding: "24px 0" }}>
                Safnið er tómt — límdu texta, sæktu vefslóð eða flyttu inn PDF til að byrja.
              </p>
            )}
            {library?.map((s) => (
              <div key={s.id} style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 2px", borderBottom: `1px solid ${T.line}` }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 16, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{s.title}</div>
                  <div style={{ color: T.dim, fontSize: 12 }}>{s.author}{s.in_books > 1 ? ` · í ${s.in_books} bókum` : ""}</div>
                </div>
                {inBook.has(s.id) ? (
                  <span style={{ color: T.live, fontSize: 13, flexShrink: 0 }}>Í bókinni ✓</span>
                ) : (
                  <button onClick={() => addFromLibrary(s)} style={{ ...btnBase, background: T.amber, color: "#221708", fontWeight: 600, padding: "7px 13px", fontSize: 13, borderColor: T.amber, flexShrink: 0 }}>＋ Bæta við</button>
                )}
                <button onClick={() => deleteFromLibrary(s)} aria-label={`Eyða ${s.title} úr safni`}
                  style={{ ...btnBase, background: "none", border: "none", color: T.faint, padding: "4px 6px", flexShrink: 0 }}>🗑</button>
              </div>
            ))}
          </div>
        )}

        {tab === "paste" && (
          <div style={{ display: "grid", gap: 10 }}>
            <Input placeholder="Titill" value={title} onChange={(e) => setTitle(e.target.value)} />
            <Input placeholder="Höfundur (valfrjálst)" value={author} onChange={(e) => setAuthor(e.target.value)} />
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
            <Input placeholder="Leita á Guitarparty … eða líma slóð" value={url}
              onChange={(e) => setUrl(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && (isUrl ? submit({ url: url.trim() }) : url.trim().length >= 2 && searchGp())} />
            {isUrl ? (
              <>
                <Btn primary disabled={busy} onClick={() => submit({ url: url.trim() })}
                  style={{ opacity: !busy ? 1 : 0.5 }}>{busy ? "Sæki og greini…" : "Sækja lag af slóðinni"}</Btn>
                <p style={{ color: T.faint, fontSize: 13 }}>
                  Guitarparty-slóðir eru studdar sérstaklega; aðrar síður eru greindar eftir bestu getu.
                </p>
              </>
            ) : (
              <>
                {gpResults === null && (
                  <Btn primary disabled={url.trim().length < 2 || busy} onClick={searchGp}
                    style={{ opacity: url.trim().length >= 2 && !busy ? 1 : 0.5 }}>
                    {busy ? "Leita…" : "Leita á Guitarparty ↗"}
                  </Btn>
                )}
                {gpResults?.length === 0 && <p style={{ color: T.faint, fontSize: 14 }}>Ekkert fannst — prófaðu annað leitarorð.</p>}
                {gpResults?.map((r) => (
                  <div key={r.id} style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 2px", borderBottom: `1px solid ${T.line}` }}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 16, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{r.title}</div>
                      <div style={{ color: T.dim, fontSize: 12 }}>{r.author}{inLibrary(r) ? " · til í safninu" : ""}</div>
                    </div>
                    {gpAdded.has(r.id) ? (
                      <span style={{ color: T.live, fontSize: 13, flexShrink: 0 }}>Komið í bókina ✓</span>
                    ) : (
                      <button onClick={() => addGpResult(r)} disabled={busy} style={{
                        ...btnBase, background: T.amber, color: "#221708", fontWeight: 600,
                        padding: "7px 13px", fontSize: 13, borderColor: T.amber, flexShrink: 0, opacity: busy ? 0.6 : 1,
                      }}>＋ Bæta við</button>
                    )}
                  </div>
                ))}
              </>
            )}
          </div>
        )}

        {tab === "pdf" && (
          <div style={{ display: "grid", gap: 10 }}>
            <Input placeholder="Titill (fyrir stök lög — söngbækur greinast sjálfkrafa)" value={title} onChange={(e) => setTitle(e.target.value)} />
            <Input placeholder="Höfundur (valfrjálst)" value={author} onChange={(e) => setAuthor(e.target.value)} />
            <input ref={fileRef} type="file" accept="application/pdf,.pdf" style={{ display: "none" }}
              onChange={(e) => onPdf(e.target.files?.[0])} />
            <div role="button" onClick={() => fileRef.current?.click()}
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => { e.preventDefault(); onPdf(e.dataTransfer.files?.[0]); }}
              style={{ border: `1.5px dashed ${T.line}`, borderRadius: 12, padding: "34px 20px", textAlign: "center", color: T.dim, cursor: "pointer" }}>
              {busy ? "Les PDF og greini…" : "Dragðu PDF hingað eða smelltu til að velja skrá"}
            </div>
            <p style={{ color: T.faint, fontSize: 13 }}>
              Guitarparty-söngbækur greinast í stök lög sjálfkrafa. Skannaðar myndir (án texta) fá villu — OCR kemur í næstu útgáfu.
            </p>
          </div>
        )}

        <div style={{ marginTop: 10 }}><ErrorText>{err}</ErrorText></div>
      </div>
    </div>
  );
}
