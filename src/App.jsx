import { useState, useEffect } from "react";
import { T, serif } from "./theme.js";
import { usePath, navigate } from "./router.jsx";
import { authClient } from "./auth.js";
import { api } from "./api.js";
import Landing from "./views/Landing.jsx";
import Login from "./views/Login.jsx";
import Dashboard from "./views/Dashboard.jsx";
import HostSession from "./views/HostSession.jsx";
import Guest from "./views/Guest.jsx";
import Admin from "./views/Admin.jsx";
import Vanity from "./views/Vanity.jsx";

function Redirect({ to }) {
  useEffect(() => { navigate(to); }, [to]);
  return null;
}

export default function App() {
  const path = usePath();
  const { data: session, isPending } = authClient.useSession();
  const [host, setHost] = useState(null); // { code, bookId } while hosting

  const startSession = async (bookId) => {
    try {
      const { code } = await api.post("/api/sessions");
      setHost({ code, bookId });
    } catch (e) {
      alert(e.message);
    }
  };

  let view = null, m;
  if ((m = path.match(/^\/s\/([A-Za-z]{4})$/))) {
    view = <Guest key={m[1].toUpperCase()} code={m[1].toUpperCase()} />;
  } else if ((m = path.match(/^\/p\/([a-z0-9-]+)$/))) {
    view = <Vanity slug={m[1]} />;
  } else if (path === "/login" || path === "/signup") {
    view = isPending ? null : session ? <Redirect to="/app" /> : <Login key={path} signup={path === "/signup"} />;
  } else if (path === "/app") {
    view = isPending ? null : !session ? <Redirect to="/login" /> : host
      ? <HostSession code={host.code} initialBookId={host.bookId} vanitySlug={session.user.vanity_slug} onExit={() => setHost(null)} />
      : <Dashboard user={session.user} onStartSession={startSession} />;
  } else if (path === "/admin") {
    view = isPending ? null : session?.user?.is_admin ? <Admin /> : <Redirect to={session ? "/app" : "/login"} />;
  } else if (path === "/") {
    view = <Landing />;
  } else if ((m = path.match(/^\/([a-z0-9-]+)\/?$/))) {
    view = <Vanity key={m[1]} slug={m[1]} />;
  } else {
    view = <Redirect to="/" />;
  }

  return (
    <div style={{ minHeight: "100vh", background: T.bg, color: T.ink, fontFamily: serif, display: "flex", flexDirection: "column" }}>
      <style>{`
        * { box-sizing: border-box; margin: 0; }
        button:focus-visible, input:focus-visible, textarea:focus-visible, select:focus-visible { outline: 2px solid ${T.amber}; outline-offset: 2px; }
        @keyframes pulse { 0%,100%{opacity:.5} 50%{opacity:1} }
        @media (prefers-reduced-motion: reduce) { * { animation:none!important; transition:none!important; scroll-behavior:auto!important } }
        ::selection { background: ${T.amberDeep}; color: ${T.bg}; }
        input::placeholder, textarea::placeholder { color: ${T.faint}; }
      `}</style>
      {view}
    </div>
  );
}
