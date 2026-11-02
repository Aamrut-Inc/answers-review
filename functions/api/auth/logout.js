import { clearSessionCookie } from "../../_lib/session.js";

export function onRequestGet({ request }) {
  return new Response(null, {
    status: 302,
    headers: { Location: new URL("/login.html", request.url).toString(), "Set-Cookie": clearSessionCookie() },
  });
}
