import { json } from "../../_lib/session.js";

export function onRequestGet({ env }) {
  return json({ domain: env.ALLOWED_DOMAIN || "" });
}
