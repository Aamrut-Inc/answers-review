/* Signed session cookie: base64url(JSON {email, exp}) + "." + HMAC-SHA256.
   SESSION_SECRET (a Pages secret) signs it; nothing is stored server-side. */

const COOKIE = "ar_session";
const MAX_AGE_S = 60 * 60 * 24 * 14; // 14 days

const enc = new TextEncoder();

function b64url(bytes) {
  let s = "";
  bytes.forEach(b => (s += String.fromCharCode(b)));
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
function fromB64url(s) {
  const bin = atob(s.replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from(bin, c => c.charCodeAt(0));
}

async function hmac(secret, data) {
  const key = await crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return new Uint8Array(await crypto.subtle.sign("HMAC", key, enc.encode(data)));
}

/* Length-independent comparison for secrets and signatures. */
export function safeEqual(a, b) {
  const x = enc.encode(String(a));
  const y = enc.encode(String(b));
  let diff = x.length ^ y.length;
  for (let i = 0; i < Math.max(x.length, y.length); i++) diff |= (x[i] || 0) ^ (y[i] || 0);
  return diff === 0;
}

export async function makeSessionCookie(env, email) {
  const payload = b64url(enc.encode(JSON.stringify({ email, exp: Math.floor(Date.now() / 1000) + MAX_AGE_S })));
  const sig = b64url(await hmac(env.SESSION_SECRET, payload));
  return `${COOKIE}=${payload}.${sig}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${MAX_AGE_S}`;
}

export function clearSessionCookie() {
  return `${COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`;
}

export async function readSession(request, env) {
  if (!env.SESSION_SECRET) return null;
  const cookie = request.headers.get("Cookie") || "";
  const m = cookie.match(new RegExp(`(?:^|;\\s*)${COOKIE}=([^;]+)`));
  if (!m) return null;
  const [payload, sig] = m[1].split(".");
  if (!payload || !sig) return null;
  if (!safeEqual(b64url(await hmac(env.SESSION_SECRET, payload)), sig)) return null;
  try {
    const data = JSON.parse(new TextDecoder().decode(fromB64url(payload)));
    return data.exp > Date.now() / 1000 ? data : null;
  } catch {
    return null;
  }
}

export function json(data, status = 200, headers = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store", ...headers },
  });
}
