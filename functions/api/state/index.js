/* GET /api/state → {states: {answer_id: state}} for every answer anyone has touched. */
import { json } from "../../_lib/session.js";

export async function onRequestGet({ env }) {
  const { results } = await env.DB.prepare("SELECT answer_id, state FROM review_state").all();
  const states = {};
  results.forEach(r => { states[r.answer_id] = JSON.parse(r.state); });
  return json({ states });
}
