import { json } from "../_lib/session.js";

export function onRequestGet({ data }) {
  return json({ email: data.user });
}
