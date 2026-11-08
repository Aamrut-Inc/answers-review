/* GET  /api/state/:id  → {state}
   POST /api/state/:id  {op, ...} → applies one operation to the latest shared state → {state, result}

   Writes use optimistic concurrency on `rev`, so two reviewers saving at
   once can't overwrite each other: the loser re-reads and re-applies. */
import { json } from "../../_lib/session.js";
import { applyOp, emptyState, OpError } from "../../_lib/review.js";

// An answer id (first 16 chars of its Braintrust root span) or a patient profile ("patient-<n>").
const ID = /^(?:[0-9a-f-]{6,64}|patient-\d{1,3})$/;

/* What goes in the audit trail. The full operation, except that an edit's
   replacement text can be 50 KB and is already kept in the state's version
   history — logging it again would grow this table without adding anything. */
const AUDIT_MAX = 4000;
function auditPayload(op) {
  const slim = { ...op };
  for (const field of ["text", "suggested_text"]) {
    if (typeof slim[field] === "string" && slim[field].length > 200) {
      slim[field] = `[${slim[field].length} chars, see the version history]`;
    }
  }
  const json = JSON.stringify(slim);
  return json.length > AUDIT_MAX ? json.slice(0, AUDIT_MAX) + "…[truncated]" : json;
}

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
    const write = rev === 0
      ? env.DB.prepare("INSERT INTO review_state (answer_id, state, rev, updated_at, updated_by) VALUES (?, ?, 1, ?, ?) ON CONFLICT(answer_id) DO NOTHING")
          .bind(params.id, body, now, data.user)
      : env.DB.prepare("UPDATE review_state SET state = ?, rev = rev + 1, updated_at = ?, updated_by = ? WHERE answer_id = ? AND rev = ?")
          .bind(body, now, data.user, params.id, rev);

    // The audit row is written in the same batch, guarded by changes() > 0, so
    // a write that lost the optimistic-concurrency race doesn't log an event
    // that never happened.
    const [res] = await env.DB.batch([
      write,
      env.DB.prepare("INSERT INTO review_events (answer_id, op, payload, email, at) SELECT ?, ?, ?, ?, ? WHERE changes() > 0")
        .bind(params.id, op.op, auditPayload(op), data.user, now),
    ]);
    if (res.meta.changes === 1) return json({ state, result });
  }
  return json({ error: "Too many people are editing this answer right now — try again." }, 409);
}
