/* GET  /api/state/:id  → {state}
   POST /api/state/:id  {op, ...} → applies one operation to the latest shared state → {state, result}

   Writes use optimistic concurrency on `rev`, so two reviewers saving at
   once can't overwrite each other: the loser re-reads and re-applies. */
import { json } from "../../_lib/session.js";
import { applyOp, emptyState, OpError } from "../../_lib/review.js";

// An answer id (first 16 chars of its Braintrust root span) or a patient profile ("patient-<n>").
const ID = /^(?:[0-9a-f-]{6,64}|patient-\d{1,3})$/;

async function load(db, id) {
  const row = await db.prepare("SELECT state, rev FROM review_state WHERE answer_id = ?").bind(id).first();
  return row ? { state: JSON.parse(row.state), rev: row.rev } : { state: emptyState(), rev: 0 };
}

export async function onRequestGet({ params, env }) {
  if (!ID.test(params.id)) return json({ error: "Bad id" }, 400);
  return json({ state: (await load(env.DB, params.id)).state });
}

export async function onRequestPost({ params, env, request, data }) {
  if (!ID.test(params.id)) return json({ error: "Bad id" }, 400);
  let op;
  try { op = await request.json(); } catch { return json({ error: "Bad request" }, 400); }

  for (let attempt = 0; attempt < 5; attempt++) {
    const { state, rev } = await load(env.DB, params.id);
    let result;
    try {
      result = applyOp(state, op, data.user);
    } catch (e) {
      if (e instanceof OpError) return json({ error: e.message, state }, 409);
      throw e;
    }
    const body = JSON.stringify(state);
    const now = new Date().toISOString();
    const res = rev === 0
      ? await env.DB.prepare("INSERT INTO review_state (answer_id, state, rev, updated_at, updated_by) VALUES (?, ?, 1, ?, ?) ON CONFLICT(answer_id) DO NOTHING")
          .bind(params.id, body, now, data.user).run()
      : await env.DB.prepare("UPDATE review_state SET state = ?, rev = rev + 1, updated_at = ?, updated_by = ? WHERE answer_id = ? AND rev = ?")
          .bind(body, now, data.user, params.id, rev).run();
    if (res.meta.changes === 1) return json({ state, result });
  }
  return json({ error: "Too many people are editing this answer right now — try again." }, 409);
}
