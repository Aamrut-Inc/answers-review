/* POST {email, password}: work email on ALLOWED_DOMAIN + the shared TEAM_PASSWORD. */
import { makeSessionCookie, safeEqual, json } from "../../_lib/session.js";

export async function onRequestPost({ request, env }) {
  if (!env.TEAM_PASSWORD || !env.SESSION_SECRET) return json({ error: "Sign-in isn't configured on the server yet." }, 500);
  let body;
  try { body = await request.json(); } catch { return json({ error: "Bad request" }, 400); }
  const email = String(body.email || "").trim().toLowerCase();
  const domain = String(env.ALLOWED_DOMAIN || "").toLowerCase();
  if (!/^[^@\s]+@[^@\s]+$/.test(email) || (domain && !email.endsWith("@" + domain))) {
    return json({ error: `Use your @${domain} work email.` }, 403);
  }
  // Trimmed: secrets piped in from a shell often carry a trailing newline.
  if (!safeEqual(String(body.password || ""), env.TEAM_PASSWORD.trim())) {
    return json({ error: "Wrong team password." }, 403);
  }
  return json({ email }, 200, { "Set-Cookie": await makeSessionCookie(env, email) });
}
