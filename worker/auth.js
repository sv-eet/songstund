import { betterAuth } from "better-auth";
import { Kysely } from "kysely";
import { D1Dialect } from "kysely-d1";

// Icelandic-friendly slugify for vanity URLs (/p/{slug}).
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
    emailAndPassword: { enabled: true },
    user: {
      additionalFields: {
        subscription_status: { type: "string", defaultValue: "active", input: false },
        vanity_slug: { type: "string", required: false, input: false },
        is_admin: { type: "boolean", defaultValue: false, input: false },
      },
    },
    databaseHooks: {
      user: {
        create: {
          before: async (user) => {
            const base = slugify(user.name || user.email.split("@")[0]);
            let slug = base;
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
