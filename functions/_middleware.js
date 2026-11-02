/* Everything except the sign-in page and auth endpoints needs a session.
   Pages get redirected to sign-in; API and data requests get a 401. */
import { readSession, json } from "./_lib/session.js";

const PUBLIC = [/^\/login(\.html)?$/, /^\/api\/auth\//, /^\/favicon\.ico$/];

export async function onRequest(context) {
  const { request, env, next, data } = context;
  const url = new URL(request.url);
  if (PUBLIC.some(re => re.test(url.pathname))) return next();

  const session = await readSession(request, env);
  if (!session) {
    const wantsPage = request.method === "GET" && (url.pathname === "/" || url.pathname.endsWith(".html") || !url.pathname.includes("."))
      && !url.pathname.startsWith("/api/");
    if (wantsPage) {
      return Response.redirect(`${url.origin}/login.html?next=${encodeURIComponent(url.pathname + url.search)}`, 302);
    }
    return json({ error: "Not signed in" }, 401);
  }
  data.user = session.email;
  const res = await next();
  // Nothing behind sign-in should sit in a shared cache.
  const out = new Response(res.body, res);
  out.headers.set("Cache-Control", "private, no-store");
  return out;
}
