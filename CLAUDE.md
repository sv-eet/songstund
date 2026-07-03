# Söngstund — samskiptalausnir.is

Synced sing-along platform: a guitarist (the "player") hosts a session from their
songbook; guests scan a QR code and follow the lyrics on their phones in real time.
The guitarist controls the current line (tap / next / autoscroll); guests' screens
follow instantly.

**Reference implementation:** `songstund-platform.jsx` in the repo root is a working
single-file React demo of the entire product (UI, flows, and the chord-sheet parser).
Port its UI, visual design, and logic. It uses mock auth and polling-based sync —
replace those as specified below. Icelandic UI language throughout.

## Stack (Cloudflare)

- **Hosting:** Cloudflare Worker with static assets serving a Vite + React SPA
- **Live sync:** one Durable Object per session room (4-letter code), WebSockets.
  Host pushes `{ songId, line, song }` state; guests receive pushes. DO hibernation
  API to keep costs near zero.
- **Database:** D1 (SQLite) — users, songbooks, songs (parsed), sessions
- **Auth:** better-auth with email/password on D1. Session cookies.
- **Custom domain:** songstund.samskiptalausnir.is (zone already on this Cloudflare
  account — attach via wrangler custom domain)
- **CI/CD:** GitHub Actions, `wrangler deploy` on push to main
- **Payments:** NOT in v1. Leave a `subscription_status` column on users
  (default 'active') so the Stripe integration bolts on later without migration pain.

## Data model

```
users:      id, email, password_hash (better-auth managed), created_at,
            subscription_status, vanity_slug (unique, for /p/{slug})
songbooks:  id, user_id, name, created_at
songs:      id, songbook_id, title, author, key, source, lines_json, created_at
sessions:   code (PK, 4 letters), user_id, created_at, ended_at
```

`lines_json` = the parsed song: `[{ "c": "chord line", "t": "lyric line" }, ...]`
Empty `{c:"",t:""}` = blank line / verse break. This one structured format renders
both views: with chords (host default, monospace) and lyrics-only (guest default,
serif). Chord display is a client-side toggle available to both host and guests.
Never store or serve raw PDFs/HTML to clients.

## Routes

- `/` — landing: join-by-code input + player login
- `/login`, `/signup` — email/password
- `/app` — player dashboard: songbook CRUD, import, start session
- `/s/{code}` — guest join (this URL is what the QR encodes)
- `/p/{slug}` — vanity redirect to the player's currently active session (404-friendly
  message if none active)
- `/admin` — admin portal (role via an `is_admin` flag): users, subscription status,
  active sessions, import/parse log

## Song import (Worker endpoint `POST /api/import`)

Accepts `{ url }` or `{ pdfText }` or `{ pasted }` (client extracts PDF text with
pdf.js in the browser to keep the Worker light; Worker fetches URLs server-side).

1. URL: fetch the page (e.g. guitarparty.com song pages), extract the chord/lyric
   block from the HTML, normalize to plain text.
2. All paths converge on the parser (see `parseSheet` / `isChordLine` in
   songstund-platform.jsx): a line whose whitespace-split tokens are ≥70% chord
   tokens (`[A-G](#|b)?(m|maj|min|dim|aug|add|sus)?[0-9]{0,2}(/[A-G](#|b)?)?`)
   is a chord line and pairs with the following lyric line.
3. Scanned/image PDFs (no extractable text): reject with a friendly Icelandic
   error. OCR is v2.
4. Log every import (success/failure + counts) to an `import_log` table for /admin.

Imported songs are private to the importing user's account — not shared, not public,
not searchable. (Licensing: users import content they have access to.)

## Session sync (Durable Object)

- Host connects via WS with auth; guests connect read-only, no auth required.
- State: `{ code, songId, line, song: {title, author, lines}, updatedAt }` —
  the full song payload is included so guests never need DB access.
- Host events: `select_song`, `set_line`. DO broadcasts state to all guests.
- Autoscroll runs client-side on the host (interval advances line, skipping blank
  lines) — each advance is just a `set_line`.
- Guest UI shows connection state (live dot / "samband rofið" after timeout).
- Room codes: 4 chars from `BDFGHJKLMNPRSTV` (no vowels — avoids real words).

## UI notes

- Keep the visual identity from the demo exactly: dark warm palette (bg #171310,
  amber #F0A85C), serif lyrics, monospace chords, amber glow on current line.
- QR code: real one (`qrcode` npm package), encoding `https://songstund.samskiptalausnir.is/s/{code}`.
- Mobile-first; guests are 100% phones. Respect prefers-reduced-motion.
- Guest view: current line highlighted, past lines dimmed, auto scroll-into-view.

## Environment / workflow notes

- Developer is on Windows PowerShell: chain commands with `;`, never `&&`.
- Use wrangler v4+, D1 migrations in `/migrations`, and keep secrets in
  `wrangler secret` (never commit).
- Structure: `/src` (React app), `/worker` (Worker + DO), single wrangler.jsonc.
- After scaffolding, always verify `npm run build` and `wrangler deploy --dry-run`
  pass before committing.

## v1 scope guard

In: auth, songbook CRUD, paste/URL/PDF-text import, sessions with QR + vanity URL,
live sync, chord toggle, admin portal (read-only tables + import log).
Out (v2): Stripe subscriptions, OCR, transposition, setlists, multi-guitarist rooms.
