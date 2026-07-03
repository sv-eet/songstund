import { useState, useEffect, useCallback } from "react";
import { T, mono } from "../theme.js";
import { Tag, Btn, SongLines, ErrorText, btnBase } from "../ui.jsx";
import { navigate } from "../router.jsx";
import { api } from "../api.js";
import { authClient } from "../auth.js";
import ImportModal from "./ImportModal.jsx";

export default function Dashboard({ user, onStartSession }) {
  const [books, setBooks] = useState(null);
  const [bookId, setBookId] = useState(null);
  const [songs, setSongs] = useState([]);
  const [importing, setImporting] = useState(false);
  const [preview, setPreview] = useState(null);
  const [showChords, setShowChords] = useState(true);
  const [err, setErr] = useState("");

  const pending = !user.approved && !user.is_admin;

  useEffect(() => {
    if (pending) return;
    api.get("/api/songbooks")
      .then(({ songbooks }) => { setBooks(songbooks); setBookId((id) => id ?? songbooks[0]?.id); })
      .catch((e) => setErr(e.message));
  }, [pending]);

  const loadSongs = useCallback(() => {
    if (!bookId) return;
    api.get(`/api/songbooks/${bookId}/songs`)
      .then(({ songs }) => setSongs(songs))
      .catch((e) => setErr(e.message));
  }, [bookId]);
  useEffect(loadSongs, [loadSongs]);

  const addBook = async () => {
    const name = window.prompt("Nafn á nýrri söngbók:");
    if (!name?.trim()) return;
    try {
      const { songbook } = await api.post("/api/songbooks", { name });
      setBooks([...(books ?? []), songbook]);
      setBookId(songbook.id);
    } catch (e) { setErr(e.message); }
  };

  const renameBook = async () => {
    const book = books?.find((b) => b.id === bookId);
    const name = window.prompt("Nýtt nafn á söngbók:", book?.name ?? "");
    if (!name?.trim()) return;
    try {
      await api.patch(`/api/songbooks/${bookId}`, { name });
      setBooks(books.map((b) => (b.id === bookId ? { ...b, name: name.trim() } : b)));
    } catch (e) { setErr(e.message); }
  };

  const deleteBook = async () => {
    const book = books?.find((b) => b.id === bookId);
    if (!window.confirm(`Eyða söngbókinni „${book?.name}“ og öllum lögum í henni?`)) return;
    try {
      await api.del(`/api/songbooks/${bookId}`);
      const next = books.filter((b) => b.id !== bookId);
      setBooks(next);
      setBookId(next[0]?.id ?? null);
      if (!next.length) { setSongs([]); const { songbooks } = await api.get("/api/songbooks"); setBooks(songbooks); setBookId(songbooks[0]?.id); }
    } catch (e) { setErr(e.message); }
  };

  const deleteSong = async (s) => {
    try {
      await api.del(`/api/songs/${s.id}`);
      setSongs(songs.filter((x) => x.id !== s.id));
    } catch (e) { setErr(e.message); }
  };

  const logout = async () => {
    await authClient.signOut();
    navigate("/");
  };

  if (pending) {
    return (
      <div style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: 24, textAlign: "center" }}>
        <div style={{ fontSize: 40, marginBottom: 14 }}>♪</div>
        <h2 style={{ fontSize: 24, fontWeight: 500, marginBottom: 10 }}>Beðið eftir samþykki</h2>
        <p style={{ color: T.dim, fontSize: 16, maxWidth: 340, lineHeight: 1.5, marginBottom: 24 }}>
          Aðgangurinn þinn hefur verið stofnaður og bíður nú samþykkis umsjónarmanns.
          Þú færð aðgang að söngbókinni um leið og hann hefur verið samþykktur.
        </p>
        <Btn onClick={logout}>Útskrá</Btn>
      </div>
    );
  }

  const prevSong = songs.find((s) => s.id === preview);
  if (prevSong) {
    return (
      <div style={{ flex: 1, maxWidth: 640, width: "100%", margin: "0 auto", padding: "20px 24px 60px" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
          <button onClick={() => setPreview(null)} style={{ ...btnBase, background: "none", border: "none", color: T.faint, padding: 0 }}>← Söngbók</button>
          <label style={{ display: "flex", alignItems: "center", gap: 8, color: T.dim, fontSize: 14, cursor: "pointer" }}>
            <input type="checkbox" checked={showChords} onChange={(e) => setShowChords(e.target.checked)} style={{ accentColor: T.amber }} />
            Sýna hljóma
          </label>
        </div>
        <h2 style={{ fontSize: 26, fontWeight: 500 }}>{prevSong.title}</h2>
        <p style={{ color: T.dim, fontSize: 13, marginBottom: 20 }}>{prevSong.author}{prevSong.source ? ` · ${prevSong.source}` : ""}</p>
        <SongLines song={prevSong} showChords={showChords} />
      </div>
    );
  }

  return (
    <div style={{ flex: 1, maxWidth: 560, width: "100%", margin: "0 auto", padding: "22px 24px 60px" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <Tag color={T.amber}>söngstund</Tag>
        <div style={{ display: "flex", gap: 14 }}>
          {user.is_admin && (
            <button onClick={() => navigate("/admin")} style={{ ...btnBase, background: "none", border: "none", color: T.faint, fontSize: 13, padding: 0 }}>Stjórnborð</button>
          )}
          <button onClick={logout} style={{ ...btnBase, background: "none", border: "none", color: T.faint, fontSize: 13, padding: 0 }}>Útskrá</button>
        </div>
      </div>
      <h1 style={{ fontSize: 30, fontWeight: 500, margin: "14px 0 2px" }}>
        {books?.find((b) => b.id === bookId)?.name ?? "Söngbókin mín"}
      </h1>
      <p style={{ color: T.dim, fontSize: 14, marginBottom: 6 }}>{user.email}</p>
      <p style={{ marginBottom: 16 }}>
        <Tag color={T.live}>áskrift {user.subscription_status === "active" ? "virk" : user.subscription_status}</Tag>
        {user.vanity_slug && (
          <span style={{ fontFamily: mono, fontSize: 12, color: T.faint, marginLeft: 12 }}>/p/{user.vanity_slug}</span>
        )}
      </p>

      {books && books.length >= 1 && (
        <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 16, flexWrap: "wrap" }}>
          <select value={bookId ?? ""} onChange={(e) => setBookId(e.target.value)} aria-label="Velja söngbók"
            style={{ background: T.surface, color: T.ink, border: `1px solid ${T.line}`, borderRadius: 8, padding: "8px 10px", font: "inherit", fontSize: 14, flex: 1, minWidth: 140 }}>
            {books.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
          </select>
          <button onClick={addBook} title="Ný söngbók" style={{ ...btnBase, background: "none", color: T.dim, padding: "8px 11px", fontSize: 14 }}>＋</button>
          <button onClick={renameBook} title="Endurnefna" style={{ ...btnBase, background: "none", color: T.dim, padding: "8px 11px", fontSize: 14 }}>✎</button>
          <button onClick={deleteBook} title="Eyða söngbók" style={{ ...btnBase, background: "none", color: T.red, padding: "8px 11px", fontSize: 14 }}>✕</button>
        </div>
      )}

      <div style={{ display: "flex", gap: 10, marginBottom: 22 }}>
        <Btn primary style={{ flex: 1, opacity: songs.length ? 1 : 0.5 }} onClick={() => onStartSession(songs)} disabled={!songs.length}>▶ Hefja söngstund</Btn>
        <Btn onClick={() => setImporting(true)}>＋ Lag</Btn>
      </div>

      <ErrorText>{err}</ErrorText>

      {books && songs.length === 0 && (
        <p style={{ color: T.faint, textAlign: "center", padding: "40px 0" }}>
          Söngbókin er tóm — bættu við fyrsta laginu.
        </p>
      )}
      {songs.map((s) => (
        <div key={s.id} style={{
          display: "flex", justifyContent: "space-between", alignItems: "center",
          background: T.surface, border: `1px solid ${T.line}`, borderRadius: 12,
          padding: "14px 16px", marginBottom: 10,
        }}>
          <button onClick={() => setPreview(s.id)} style={{ ...btnBase, background: "none", border: "none", textAlign: "left", color: T.ink, padding: 0, flex: 1 }}>
            <span style={{ display: "block", fontSize: 17 }}>{s.title}</span>
            <span style={{ color: T.dim, fontSize: 13 }}>{s.author || s.source}</span>
          </button>
          <button onClick={() => deleteSong(s)}
            aria-label={`Eyða ${s.title}`}
            style={{ ...btnBase, background: "none", border: "none", color: T.faint, padding: "4px 8px" }}>✕</button>
        </div>
      ))}

      {importing && (
        <ImportModal songbookId={bookId} onClose={() => setImporting(false)}
          onAdded={(added) => setSongs((cur) => [...cur, ...added])} />
      )}
    </div>
  );
}
