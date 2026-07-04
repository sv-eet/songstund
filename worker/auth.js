import { betterAuth } from "better-auth";
import { Kysely } from "kysely";
import { D1Dialect } from "kysely-d1";
import { sendEmail } from "./email.js";

// Paths that can never be claimed as a vanity slug.
export const RESERVED_SLUGS = new Set([
  "api", "app", "admin", "login", "signup", "reset", "s", "p", "assets",
  "favicon.ico", "robots.txt", "index.html", "songstund",
  "manifest.webmanifest", "icon.svg",
]);

// Icelandic-friendly slugify for vanity URLs (songstund…/{slug}).
export function slugify(s) {
  const map = { á: "a", é: "e", í: "i", ó: "o", ú: "u", ý: "y", ð: "d", þ: "th", æ: "ae", ö: "o" };
  return s
    .toLowerCase()
    .replace(/[áéíóúýðþæö]/g, (ch) => map[ch])
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40) || "spilari";
}

let auth = null;

export function getAuth(env) {
  if (auth) return auth;
  auth = betterAuth({
    database: {
      db: new Kysely({ dialect: new D1Dialect({ database: env.DB }) }),
      type: "sqlite",
    },
    secret: env.BETTER_AUTH_SECRET,
    baseURL: env.APP_URL,
    basePath: "/api/auth",
    trustedOrigins: [
      env.APP_URL,
      // wrangler dev simulates the custom-domain route over plain http
      "https://songstund.samskiptalausnir.is",
      "http://songstund.samskiptalausnir.is",
      "http://localhost:8787",
      "http://127.0.0.1:8787",
      "http://localhost:5173",
    ],
    emailAndPassword: {
      enabled: true,
      sendResetPassword: async ({ user, url }) => {
        await sendEmail(env, {
          to: user.email,
          subject: "Endurstilla lykilorð — Söngstund",
          text: `Sæl/l,\n\nSmelltu á hlekkinn til að velja nýtt lykilorð á Söngstund:\n${url}\n\nHlekkurinn gildir í klukkustund. Ef þú baðst ekki um endurstillingu máttu hunsa þennan póst.\n\n— Söngstund · samskiptalausnir.is`,
          html: `<div style="font-family:Georgia,serif;max-width:480px;margin:0 auto;padding:24px;background:#171310;color:#EFE4D2;border-radius:12px">
            <p style="font-family:monospace;font-size:11px;letter-spacing:.14em;color:#F0A85C;text-transform:uppercase">söngstund · samskiptalausnir.is</p>
            <h2 style="font-weight:500">Endurstilla lykilorð</h2>
            <p style="color:#9A8875;line-height:1.5">Smelltu á hnappinn til að velja nýtt lykilorð. Hlekkurinn gildir í klukkustund.</p>
            <p style="margin:28px 0"><a href="${url}" style="background:#F0A85C;color:#221708;font-weight:600;padding:13px 22px;border-radius:10px;text-decoration:none">Velja nýtt lykilorð</a></p>
            <p style="color:#6B5D4E;font-size:13px;line-height:1.5">Ef þú baðst ekki um endurstillingu máttu hunsa þennan póst.</p>
          </div>`,
        });
      },
    },
    user: {
      additionalFields: {
        subscription_status: { type: "string", defaultValue: "active", input: false },
        vanity_slug: { type: "string", required: false, input: false },
        is_admin: { type: "boolean", defaultValue: false, input: false },
        approved: { type: "boolean", defaultValue: false, input: false },
      },
    },
    databaseHooks: {
      user: {
        create: {
          before: async (user) => {
            const base = slugify(user.name || user.email.split("@")[0]);
            let slug = RESERVED_SLUGS.has(base) ? `${base}-spilari` : base;
            for (let i = 0; i < 5; i++) {
              const hit = await env.DB.prepare('SELECT 1 FROM "user" WHERE vanity_slug = ?')
                .bind(slug).first();
              if (!hit) break;
              slug = `${base}-${Math.floor(Math.random() * 900 + 100)}`;
            }
            return { data: { ...user, vanity_slug: slug } };
          },
        },
      },
    },
  });
  return auth;
}

export async function getSessionUser(request, env) {
  const session = await getAuth(env).api.getSession({ headers: request.headers });
  return session?.user ?? null;
}
