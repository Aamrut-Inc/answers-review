/* The answer view, shown inside a patient's space (patient.html#answer=<id>):
   the conversation that led to an answer, the answer itself (with in-place
   paragraph editing and versions), the judge scores, the tool calls and the
   prompts, plus the team's flags.

   const view = await createAnswerView({ container, id, index, prompts, patient, ordered });
   view.handleClick(target) / view.handleKey(event) / view.flagCtx / view.destroy() */

const STATUS_TONE = {
  SUPPORTED: "good", ACCURATE: "good", REAL_ACCURATE: "good", ASKED_APPROPRIATELY: "good", FULLY_RECONCILED: "good",
  NOT_APPLICABLE: "none",
  UNVERIFIABLE: "mid", UNCERTAIN: "mid", PARTIAL: "mid", PROCEEDED_WITH_CAVEAT: "mid",
  CONTRADICTED: "low", SHOULD_HAVE_CHECKED_DATA: "low",
};
function statusTone(s) {
  if (STATUS_TONE[s]) return STATUS_TONE[s];
  return /NOT_|MISS|FABRICAT|WRONG|INACCURATE|UNSUPPORTED|FAIL/.test(s || "") ? "low" : "mid";
}
function humanize(s) {
  const t = String(s || "").toLowerCase().replace(/_/g, " ");
  return t.charAt(0).toUpperCase() + t.slice(1);
}
function statusChip(s) {
  return `<span class="status-chip tone-${statusTone(s)}">${escapeHtml(humanize(s))}</span>`;
}
function anchorAttrs(key, label) {
  return `data-anchor="${escapeHtml(key)}" data-anchor-label="${escapeHtml(label)}"`;
}
const SCALE_NOTE = `Judge scores are levels, not percentages. For four-level rubrics, Braintrust's 0 / 0.33 / 0.67 / 1 mean
  Level 1 (serious problem) / 2 / 3 (mostly fine) / 4 (fully fine). "Asks for missing info" has three levels: 0 / 0.5 / 1 = Level 1 / 2 / 3.
  So 0.67 isn't "67% correct" — it's Level 3 of 4.`;

async function createAnswerView({ container, id, index, prompts, patient, ordered }) {
  const [answer, state] = await Promise.all([loadJSON(`data/answers/${id}.json`), getAnswerState(id)]);
  const rubrics = index.rubrics;
  const pos = ordered.findIndex(a => a.id === answer.id);
  const prev = ordered[pos - 1], next = ordered[pos + 1];

  /* ---- Turn numbers, as the judges cite them ---- */
  const turnOf = { history: {}, tool: {} };
  answer.timeline.forEach(t => {
    if (t.kind === "history" || t.kind === "tool") turnOf[t.kind][t.index] = t.turn;
    else turnOf[t.kind] = t.turn;
  });
  const kindOfTurn = {};
  answer.timeline.forEach(t => (kindOfTurn[t.turn] = t));
  const TURN_LABEL = {
    system: "system prompt", history: "conversation", question: "question", tool: "tool call",
    draft: "drafted answer", faithfulness: "faithfulness check", audit: "audit message",
    revised_draft: "revised draft", final: "answer delivered",
  };
  function turnLabel(n) {
    const t = kindOfTurn[n];
    if (!t) return `turn ${n}`;
    if (t.kind === "history") return answer.history[t.index].role === "user" ? "patient message" : "coach message";
    if (t.kind === "tool") return `${answer.tools[t.index].tool} call`;
    return TURN_LABEL[t.kind];
  }
  const judgeFlagsByTurn = {};
  rubrics.forEach(r => {
    const l = answer.rubric_latest[r.key];
    (l ? l.flagged_turns : []).forEach(t => (judgeFlagsByTurn[t] = judgeFlagsByTurn[t] || []).push(r));
  });
  function judgeMarks(turn) {
    const rs = judgeFlagsByTurn[turn];
    if (!rs) return "";
    return `<span class="judge-marks">${rs.map(r => `<button class="judge-mark" type="button" data-open-score="${r.key}" title="Flagged by the ${escapeHtml(r.name)} judge">${escapeHtml(r.short)}</button>`).join("")}</span>`;
  }

  /* ---- View state ---- */
  let view = "current"; // current | original | draft | changes
  let historyExpanded = answer.history.length <= 8;
  let editingBlock = null;
  const openScores = new Set();
  const currentText = () => textAt(state, state.version) ?? answer.final_answer;
  const isEdited = () => textAt(state, state.version) != null && textAt(state, state.version) !== answer.final_answer;
  const first = patient.name.split(" ")[0];
  const $ = sel => container.querySelector(sel);

  /* ---- Shared review machinery ---- */
  const kit = createReviewKit({
    id: answer.id, state, noun: "answer",
    onChanged: () => onChanged(),
    emptyOpenHint: "No open flags. Hover any paragraph or select text to raise one.",
    flagActions: f => `${f.suggested_text ? `<button class="btn primary small" data-apply-suggestion="${f.id}" type="button">Apply suggestion…</button>` : ""}
      <button class="btn small" data-edit-for-flag="${f.id}" type="button">${icon("edit")} Fix by editing…</button>`,
    fixBarExtra: n => `<button class="btn small" id="edit-selected" type="button" ${n ? "" : "disabled"}>Edit answer for ${n || ""} selected</button>`,
    onSelectionChange: n => { const ed = document.getElementById("edit-selected"); if (ed) { ed.disabled = !n; ed.textContent = `Edit answer for ${n || ""} selected`; } },
    versionNote: "v1 is the answer exactly as the pipeline generated it — it can't be changed or lost. Rolling back adds a new version with the older text and reopens flags fixed after it; nothing is deleted.",
    firstVersionMeta: `${answer.batch} · ${fmtDateTime(answer.created)}`,
    versionActions: v => `<button class="btn small" data-view-version="${v.version}" type="button">View</button>
      ${v.version > 1 && (v.text != null || v.original) ? `<button class="btn small" data-diff-version="${v.version}" type="button">Changes</button>` : ""}`,
    rollbackDetail: target => `with v${target}'s answer text`,
  });

  /* ---- Skeleton ---- */
  container.innerHTML = `
    <div class="subbar">
      <nav class="crumbs" aria-label="Breadcrumb">
        <a href="#questions">${icon("back")} Questions</a><span class="sep">/</span>
        <span class="here">${escapeHtml(answer.question)}</span>
      </nav>
      <div class="pager">
        <button class="btn small" type="button" data-action="snapshot">${icon("user")} Patient snapshot</button>
        <span class="rs-div"></span>
        ${prev ? `<a class="btn small ghost" href="#answer=${prev.id}" title="Previous answer (←)">${icon("back")} Prev</a>` : `<span class="btn small ghost" aria-disabled="true" style="opacity:.4">${icon("back")} Prev</span>`}
        <span>${pos + 1} of ${ordered.length}</span>
        ${next ? `<a class="btn small ghost" href="#answer=${next.id}" title="Next answer (→)">Next ${icon("next")}</a>` : `<span class="btn small ghost" aria-disabled="true" style="opacity:.4">Next ${icon("next")}</span>`}
      </div>
    </div>
    <div class="ctx-bar" id="ctx-bar" aria-hidden="true"></div>
    <div class="review-layout">
      <div class="answer-header" id="answer-head"></div>
      <section class="main-col">
        <div id="review-strip"></div>
        <div class="tabs" role="tablist">
          <button class="tab-btn active" data-tab="conversation" type="button">${icon("chat")} Conversation &amp; answer</button>
          <button class="tab-btn" data-tab="tools" type="button">${icon("tool")} How it was answered <span class="muted">${answer.tools.length}</span></button>
          <button class="tab-btn" data-tab="prompts" type="button">${icon("doc")} System prompts</button>
        </div>
        <div class="tab-panel active" id="tab-conversation"><div id="conversation"></div></div>
        <div class="tab-panel" id="tab-tools"></div>
        <div class="tab-panel" id="tab-prompts"></div>
      </section>
      <aside class="score-col" id="score-col"></aside>
    </div>`;

  /* ---- Header ---- */
  function renderHeader() {
    const m = answer.meta;
    const siblings = index.answers.filter(a => a.id !== answer.id && a.profile.n === answer.profile.n
      && a.question.trim().toLowerCase() === answer.question.trim().toLowerCase());
    $("#answer-head").innerHTML = `
      <div class="eyebrow">
        <span class="tag mono" title="Batch (config_version)">${escapeHtml(answer.batch)}</span>
        ${answer.persona ? `<span class="tag">${escapeHtml(answer.persona)} persona</span>` : ""}
        <span>${escapeHtml(fmtDateTime(answer.created))}</span>
      </div>
      <h1 class="question" style="view-transition-name: question-title" ${anchorAttrs(`turn:${turnOf.question}`, "The question")}>${escapeHtml(answer.question)}<span class="badge-slot"></span></h1>
      <div class="meta-row">
        ${m.model ? `<span>${icon("doc")}${escapeHtml(m.model)}</span>` : ""}
        <span>${icon("chat")}${plural(answer.history.length, "earlier message")}</span>
        <span>${icon("tool")}${plural(answer.tools.length, "tool call")}${m.used_web_search ? " · web search" : ""}</span>
        ${answer.duration_s ? `<span>${Math.round(answer.duration_s)}s to answer</span>` : ""}
        ${answer.revised ? `<span class="tag amber" title="The pipeline's faithfulness check triggered a rewrite">revised by pipeline</span>` : ""}
        <a class="linklike" href="https://www.braintrust.dev/app/Aamrut/p/Global/logs?r=${encodeURIComponent(answer.braintrust_row_id || answer.braintrust_root_span_id)}" target="_blank" rel="noopener">Braintrust ↗</a>
      </div>
      ${siblings.length ? `<div class="siblings">Same question elsewhere:
        ${siblings.map(s => `<a href="#answer=${s.id}" class="sibling">${escapeHtml(s.batch)}${s.persona ? ` · ${escapeHtml(s.persona)}` : ""} ${miniLevels(rubrics, s.rubric_latest)}</a>`).join("")}
      </div>` : ""}`;
  }
  function renderCtxBar() {
    const c = flagCounts(state);
    $("#ctx-bar").innerHTML = `<div class="ctx-inner">
      ${monogram(patient, "sm")}
      <span class="ctx-q">${escapeHtml(answer.question)}</span>
      <span class="tag mono">${escapeHtml(answer.batch)}</span>
      ${c.open ? `<button class="tag rust" type="button" data-action="show-open">${icon("flag")} ${c.open} open</button>` : ""}
      <span class="tag">v${state.version}</span>
      ${prev ? `<a class="icon-btn" href="#answer=${prev.id}" title="Previous answer">${icon("back")}</a>` : ""}
      ${next ? `<a class="icon-btn" href="#answer=${next.id}" title="Next answer">${icon("next")}</a>` : ""}
      <button class="icon-btn" type="button" data-action="to-top" title="Back to top">↑</button>
    </div>`;
  }

  /* ---- Conversation + answer ---- */
  function messageHtml(msg, i) {
    const turn = turnOf.history[i];
    const who = msg.role === "user" ? "Patient" : "Coach";
    return `<div class="msg ${msg.role === "user" ? "patient" : "coach"}" ${anchorAttrs(`turn:${turn}`, `Turn ${turn} · ${who}`)}>
      <div class="msg-gutter"><span class="turn-no" title="Turn number the judges use">${turn}</span></div>
      <div class="msg-body">
        <div class="msg-who">${who === "Patient" ? escapeHtml(first) : "Coach"}${judgeMarks(turn)}<span class="badge-slot"></span></div>
        <div class="msg-text">${escapeHtml(msg.content)}</div>
      </div>
    </div>`;
  }
  function renderConversation() {
    const h = answer.history;
    const hidden = historyExpanded ? 0 : Math.max(0, h.length - 6);
    $("#conversation").innerHTML = `
      ${h.length ? `<div class="conv-head">
          <h2>Conversation before the question</h2>
          <span class="muted small">${h.length} messages · turns ${turnOf.history[0]}–${turnOf.history[h.length - 1]}</span>
        </div>` : `<div class="conv-head"><h2>Conversation</h2><span class="muted small">No earlier messages were logged for this run — the question was asked cold.</span></div>`}
      ${hidden ? `<button class="show-earlier" type="button" data-action="show-earlier">Show ${plural(hidden, "earlier message")}</button>` : ""}
      <div class="msgs">${h.map((m, i) => i < hidden ? "" : messageHtml(m, i)).join("")}
        <div class="msg patient question-msg" ${anchorAttrs(`turn:${turnOf.question}`, `Turn ${turnOf.question} · The question`)}>
          <div class="msg-gutter"><span class="turn-no">${turnOf.question}</span></div>
          <div class="msg-body">
            <div class="msg-who">${escapeHtml(first)} · the question being answered${judgeMarks(turnOf.question)}<span class="badge-slot"></span></div>
            <div class="msg-text">${escapeHtml(answer.question)}</div>
          </div>
        </div>
      </div>
      <div id="answer-card"></div>`;
    renderAnswerCard();
  }
  function answerBlocksHtml(md, prefix, labelPrefix, editable) {
    return mdBlocks(md).map((b, i) => {
      if (editable && editingBlock === i) return inlineEditorHtml(i);
      return `<div class="md-block ${editable ? "editable" : ""}" ${anchorAttrs(`${prefix}:b${i}`, `${labelPrefix} · paragraph ${i + 1}`)}>
        ${editable ? `<span class="block-tools">
          <button type="button" data-edit-block="${i}" title="Edit this paragraph">${icon("edit")} Edit</button>
          <button type="button" data-flag-block="${i}" title="Flag this paragraph">${icon("flag")} Flag</button>
        </span>` : ""}
        ${b.html}<span class="badge-slot"></span></div>`;
    }).join("");
  }
  function inlineEditorHtml(i) {
    const openHere = state.flags.filter(f => f.status !== "fixed" && f.anchor && (f.anchor.key === `answer:b${i}` || f.anchor.key === "answer"));
    return `<div class="inline-editor" id="inline-editor">
      <textarea id="ie-text" aria-label="Edit paragraph ${i + 1}">${escapeHtml(blockSource(currentText(), i))}</textarea>
      ${openHere.length ? `<div class="ie-flags"><span class="label">Mark fixed with this edit</span>
        ${openHere.map(f => `<label><input type="checkbox" data-ie-flag="${f.id}" checked> ${escapeHtml(f.title)}</label>`).join("")}</div>` : ""}
      <div class="ie-row">
        <input type="text" id="ie-change" maxlength="500" placeholder="What did you change? (optional)">
        <button class="btn ghost small" type="button" data-ie="cancel">Cancel</button>
        <button class="btn primary small" type="button" data-ie="save">Save as v${state.version + 1}</button>
      </div>
      <div class="ie-row" style="border:none;padding-top:4px"><span class="ie-hint">Markdown · <kbd>Ctrl</kbd>+<kbd>Enter</kbd> to save · <kbd>Esc</kbd> to cancel · the generated answer stays as v1</span></div>
    </div>`;
  }
  function renderAnswerCard() {
    const views = [
      ["current", `Current · v${state.version}`],
      ["original", "As generated"],
      ...(answer.revised ? [["draft", "Pipeline's first draft"]] : []),
      ["changes", "Changes vs generated"],
    ];
    let body;
    if (view === "current") body = answerBlocksHtml(currentText(), "answer", `Answer v${state.version}`, true);
    else if (view === "original") body = answerBlocksHtml(answer.final_answer, "answer", "Answer as generated", false);
    else if (view === "draft") {
      body = `<div class="draft-note">This is what the assistant wrote first. The pipeline's faithfulness check sent it back with the audit below, and the assistant rewrote it (turn ${turnOf.revised_draft || "—"}).</div>
        ${answer.audit_message ? `<details class="audit" ${anchorAttrs("audit", "Pipeline audit message")}><summary>Audit message sent back to the assistant (turn ${turnOf.audit})</summary><div class="pre">${escapeHtml(answer.audit_message)}</div></details>` : ""}
        ${answerBlocksHtml(answer.original_answer, "draft", "Pipeline first draft", false)}`;
    } else body = diffHtml(answer.final_answer, currentText());

    $("#answer-card").innerHTML = `
      <section class="answer-card" ${anchorAttrs("answer", "Answer")}>
        <div class="answer-head">
          <div class="answer-title">
            <span class="turn-no" title="Turn number the judges use">${turnOf.final}</span>
            <h2>Assistant's answer</h2>${judgeMarks(turnOf.final)}${turnOf.draft !== turnOf.final ? judgeMarks(turnOf.draft) : ""}
            <span class="badge-slot"></span>
          </div>
          <div class="answer-actions">
            <button class="btn small" type="button" data-action="edit-answer">${icon("edit")} Edit whole answer</button>
          </div>
        </div>
        <div class="answer-bar">
          <div class="seg" role="tablist" aria-label="Answer view">
            ${views.map(([k, l]) => `<button type="button" role="tab" class="seg-btn ${view === k ? "active" : ""}" data-view="${k}" aria-selected="${view === k}">${escapeHtml(l)}</button>`).join("")}
          </div>
        </div>
        <div class="answer-body-wrap">
          ${view === "current" && isEdited() ? `<div class="edited-note">${icon("edit")} Edited by reviewers — the generated answer is kept as v1. <button class="linklike" type="button" data-view="changes">See what changed</button></div>` : ""}
          <div class="md">${body}</div>
        </div>
        <div class="answer-foot">
          <span>Hover a paragraph to <strong>edit</strong> or <strong>flag</strong> it</span>
          <span>Select any text to flag just that</span>
          <span><kbd>←</kbd> <kbd>→</kbd> previous / next answer</span>
        </div>
      </section>`;
    const ta = $("#ie-text");
    if (ta) {
      ta.style.height = Math.max(110, ta.scrollHeight + 4) + "px";
      ta.focus();
      ta.addEventListener("keydown", e => {
        if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) { e.preventDefault(); saveInlineEdit(); }
        if (e.key === "Escape") { e.stopPropagation(); editingBlock = null; renderAnswerCard(); decorateAnchors(); }
      });
    }
  }
  async function saveInlineEdit() {
    const i = editingBlock;
    const btn = $('[data-ie="save"]');
    if (btn) btn.disabled = true;
    try {
      const res = await applyReviewOp(answer.id, state, {
        op: "save_edit",
        text: replaceBlock(currentText(), i, $("#ie-text").value),
        change: $("#ie-change").value.trim() || `Edited paragraph ${i + 1}`,
        flag_ids: [...container.querySelectorAll("[data-ie-flag]:checked")].map(x => x.dataset.ieFlag),
      });
      editingBlock = null;
      onChanged();
      toast(`Saved as v${res.version}`);
    } catch (e) {
      if (btn) btn.disabled = false;
      toast(`Couldn't save: ${e.message}`);
    }
  }

  /* ---- Scores ---- */
  function detailTable(rows, cols) {
    return `<table class="detail-table"><tbody>${rows.map(r => `<tr>
      ${cols.map(c => c === "status" ? `<td class="st">${statusChip(r.status)}</td>`
        : c === "turn" ? `<td class="tn">${r.turn ? `<button class="linklike" type="button" data-goto-turn="${r.turn}">T${r.turn}</button>` : ""}</td>`
        : `<td>${escapeHtml(r[c])}</td>`).join("")}</tr>`).join("")}</tbody></table>`;
  }
  function scoreDetails(d) {
    let html = "";
    if (d.claims) html += `<div class="detail-h">Claims about the patient's data</div>${detailTable(d.claims, ["claim", "status", "turn"])}`;
    if (d.medical_claims) html += `<div class="detail-h">Medical claims</div>${detailTable(d.medical_claims, ["claim", "status", "turn"])}`;
    if (d.citations) html += `<div class="detail-h">Citations</div>${detailTable(d.citations, ["citation", "status", "turn"])}`;
    if (d.turn_classifications) {
      const counts = {};
      d.turn_classifications.forEach(t => (counts[t.status] = (counts[t.status] || 0) + 1));
      const notable = d.turn_classifications.filter(t => t.status !== "NOT_APPLICABLE");
      html += `<div class="detail-h">Turn by turn</div>
        <div class="chip-row">${Object.entries(counts).map(([s, n]) => `${statusChip(s)}<span class="cnt">×${n}</span>`).join(" ")}</div>
        ${notable.length ? `<div class="turn-list">${notable.map(t => `<button class="turn-pill tone-${statusTone(t.status)}" type="button" data-goto-turn="${t.turn}" title="${escapeHtml(humanize(t.status))}">T${t.turn}</button>`).join("")}</div>` : ""}`;
    }
    if (d.turns) {
      const rows = d.turns.filter(t => t.status !== "NOT_APPLICABLE");
      html += `<div class="detail-h">Intent vs need</div>${rows.length ? rows.map(t => `
        <div class="intent-row">
          <div><button class="linklike" type="button" data-goto-turn="${t.turn}">T${t.turn}</button> ${statusChip(t.status)}${t.safety_relevant_miss ? ` <span class="status-chip tone-low">Safety-relevant miss</span>` : ""}</div>
          <div><span class="muted">Asked for:</span> ${escapeHtml(t.intent)}</div>
          <div><span class="muted">Needed:</span> ${escapeHtml(t.need)}</div>
        </div>`).join("") : `<div class="muted small">All ${d.turns.length} turns were not applicable.</div>`}`;
    }
    if (d.judge_search_queries) html += `<div class="detail-h">Judge's own searches</div><ul class="plain">${d.judge_search_queries.map(q => `<li>${escapeHtml(q)}</li>`).join("")}</ul>`;
    return html;
  }
  function scoreCard(r) {
    const runs = answer.rubrics[r.key] || [];
    const ok = runs.filter(x => x.ok);
    const latest = ok[ok.length - 1];
    const failed = runs.filter(x => !x.ok);
    const human = state.human_levels[r.key];
    const level = latest ? latest.level : null;
    const disagree = human && latest && human.level !== latest.level;
    const open = openScores.has(r.key);
    const failReasons = {};
    failed.forEach(f => (failReasons[f.error] = (failReasons[f.error] || 0) + 1));
    const reasons = Object.entries(failReasons).map(([e, n]) => `${escapeHtml(e)} (×${n})`).join(", ");
    return `<div class="score-card ${open ? "open" : ""}" ${anchorAttrs(`score:${r.key}`, `Judge score: ${r.short}`)}>
      <button class="score-head" type="button" data-toggle-score="${r.key}" aria-expanded="${open}">
        <span class="score-name">${escapeHtml(r.short)}<span class="badge-slot"></span></span>
        ${levelPips(level, r.max)}
        <span class="score-level tone-${levelTone(level, r.max)}">${levelText(level, r.max)}</span>
        ${human ? `<span class="human-chip ${disagree ? "disagree" : ""}" title="Reviewer level by ${escapeHtml(human.by)}">you ${human.level}</span>` : ""}
      </button>
      <div class="score-body">
        ${latest ? `
          <div class="score-sub">Level ${latest.level} of ${r.max}${latest.score != null ? ` · ${latest.score} in Braintrust` : ""} · ${escapeHtml(fmtDateTime(latest.created))}</div>
          ${latest.judge_tools_failed ? `<div class="warn">The judge's own data tools failed on this run, so it judged from the assistant's evidence alone.</div>` : ""}
          <div class="rationale">${escapeHtml(latest.rationale)}</div>
          ${latest.flagged_turns.length ? `<div class="detail-h">Turns the judge flagged</div><div class="turn-list">${latest.flagged_turns.map(t =>
            `<button class="turn-pill tone-low" type="button" data-goto-turn="${t}">T${t} · ${escapeHtml(turnLabel(t))}</button>`).join("")}</div>` : ""}
          ${scoreDetails(latest.details)}`
        : `<div class="warn">${runs.length ? `Not scored — every judge run failed: ${reasons}.` : "This answer hasn't been through this judge."}</div>`}
        ${latest && failed.length ? `<div class="muted small">${plural(failed.length, "other run")} failed: ${reasons}.</div>` : ""}
        ${failed.filter(f => f.raw).slice(-1).map(f => `<details class="raw"><summary>Judge's unparsed reply</summary><div class="pre">${escapeHtml(f.raw)}</div></details>`).join("")}
        <div class="human-box">
          <div class="detail-h">Your level</div>
          <div class="level-btns" role="group" aria-label="Your level for ${escapeHtml(r.short)}">
            ${Array.from({ length: r.max }, (_, i) => i + 1).map(l => `<button type="button" class="level-btn tone-${levelTone(l, r.max)} ${human && human.level === l ? "on" : ""}" data-human-level="${l}" data-rubric="${r.key}" title="Level ${l} of ${r.max}">${l}</button>`).join("")}
          </div>
          <textarea rows="2" id="human-note-${r.key}" placeholder="Why? (optional — saved with your level)">${escapeHtml(human ? human.note : "")}</textarea>
          <div class="human-actions">
            ${human ? `<span class="muted small">By ${escapeHtml(human.by.split("@")[0])} · ${escapeHtml(fmtDateTime(human.date))}</span>
              <button class="linklike small" type="button" data-clear-human="${r.key}">Clear</button>` : `<span class="muted small">Pick a level to record your own judgement.</span>`}
            <button class="btn small" type="button" data-flag-score="${r.key}">${icon("flag")} Flag score</button>
          </div>
        </div>
      </div>
    </div>`;
  }
  function faithfulnessCard() {
    const f = answer.faithfulness;
    if (!f.length) return "";
    return `<div class="faith-card" ${anchorAttrs("faith", "Pipeline faithfulness check")}>
      <div class="faith-head"><span>Pipeline faithfulness check</span>${judgeMarks(turnOf.faithfulness)}<span class="badge-slot"></span></div>
      ${f.map(x => `<div class="faith-row">
        <span class="muted small">${answer.revised ? (x.phase === "revision" ? "After revision" : "First draft") : "Answer"}</span>
        <span class="status-chip tone-${x.verdict === "grounded" ? "good" : x.verdict === "unsupported" ? "low" : "mid"}">${escapeHtml(humanize(x.verdict || "unknown"))}</span>
        ${x.score != null ? `<span class="mono small">${x.score}</span>` : ""}
      </div>
      ${x.unsupported_claims.length ? `<details class="faith-claims"><summary>${plural(x.unsupported_claims.length, "unsupported claim")}</summary>
        <ul class="plain">${x.unsupported_claims.map(c => `<li>${escapeHtml(c)}</li>`).join("")}</ul></details>` : ""}`).join("")}
    </div>`;
  }
  function renderScores() {
    const s = answer.scoring;
    $("#score-col").innerHTML = `
      <div class="score-panel">
        <div class="score-panel-head">
          <h2>Judge scores</h2>
          <button class="info-btn" type="button" data-action="scale-info" aria-label="How to read these scores">?</button>
        </div>
        <p class="scale-hint">Levels, not percentages — 3/4 means "mostly fine". Click a score for the judge's reasoning.</p>
        ${s.status === "failed" || s.status === "not_scored" ? `<div class="warn">${s.status === "failed"
          ? `None of the rubric judges finished for this answer (${s.attempts} attempts): ${Object.entries(s.errors).map(([e, n]) => `${escapeHtml(e)} ×${n}`).join(", ")}.`
          : "The rubric judges haven't run on this answer."} You can still record your own levels.</div>` : ""}
        ${rubrics.map(scoreCard).join("")}
        <div class="muted small human-count">${Object.keys(state.human_levels).length}/${rubrics.length} levels checked by a reviewer</div>
        ${faithfulnessCard()}
      </div>`;
  }

  /* ---- Tools + prompts ---- */
  function renderTools() {
    $("#tab-tools").innerHTML = answer.tools.length ? `
      <p class="section-note">Every tool call the assistant made, in order, with the turn number the judges use. Calls made during the pipeline's revision are marked.</p>
      ${answer.tools.map((t, i) => `<details class="tool" ${anchorAttrs(`tool:${i}`, `Tool call: ${t.tool} (turn ${turnOf.tool[i]})`)}>
        <summary><span class="turn-no">${turnOf.tool[i]}</span><span class="tool-name">${escapeHtml(t.tool)}</span>
          ${t.phase === "revision" ? `<span class="tag amber">revision</span>` : ""}
          ${t.error ? `<span class="tag rust">error</span>` : ""}
          <span class="tool-preview">${escapeHtml(truncate(t.input, 110))}</span>${judgeMarks(turnOf.tool[i])}<span class="badge-slot"></span></summary>
        <div class="tool-io">
          <div class="detail-h">Input</div><div class="pre">${escapeHtml(t.input)}</div>
          <div class="detail-h">Output</div><div class="pre">${escapeHtml(t.output || "(empty)")}</div>
          ${t.error ? `<div class="detail-h">Error</div><div class="pre">${escapeHtml(t.error)}</div>` : ""}
          ${t.from_model_output ? `<div class="muted small" style="margin-top:6px">Braintrust has no separate span for this call; it was read from the model's output.</div>` : ""}
        </div>
      </details>`).join("")}` : `<div class="empty-note">The assistant answered without calling any tools.</div>`;
  }
  function renderPrompts() {
    const ap = prompts.assistant.find(p => p.id === answer.system_prompt_id);
    $("#tab-prompts").innerHTML = `
      <section class="prompt-sec" ${anchorAttrs("prompt:assistant", "Assistant system prompt")}>
        <div class="prompt-head"><h2>Health assistant — system prompt</h2><span class="muted small">turn 1 to the judges</span>${judgeMarks(1)}<span class="badge-slot"></span></div>
        ${ap ? `<div class="chip-list"><span class="muted small">Used by</span> ${ap.batches.map(b => `<span class="tag mono">${escapeHtml(b)}</span>`).join(" ")}</div>
          <div class="prompt-text">${escapeHtml(ap.text)}</div>`
        : `<div class="warn">This batch (${escapeHtml(answer.batch)}) didn't log its system prompt to Braintrust.</div>`}
      </section>
      <section class="prompt-sec">
        <div class="prompt-head"><h2>LLM-as-judge — rubric prompts</h2></div>
        <p class="scale-note">${SCALE_NOTE}</p>
        ${rubrics.map(r => `<details class="judge-prompt" ${anchorAttrs(`prompt:judge:${r.key}`, `Judge prompt: ${r.short}`)}>
          <summary><strong>${escapeHtml(r.name)}</strong> <span class="muted small">${r.max} levels</span><span class="badge-slot"></span></summary>
          ${prompts.rubric_judges[r.key] ? `<div class="prompt-text">${escapeHtml(prompts.rubric_judges[r.key])}</div>`
            : `<div class="warn">Not loaded yet. The judge prompts live in the scorer code, not the logs — save this one as <code>judge_prompts/${r.key}.md</code> and re-run the build.</div>`}
        </details>`).join("")}
      </section>
      ${prompts.faithfulness_judge ? `<section class="prompt-sec" ${anchorAttrs("prompt:faithfulness", "Faithfulness judge prompt")}>
        <div class="prompt-head"><h2>Pipeline faithfulness judge — prompt</h2><span class="badge-slot"></span></div>
        <div class="prompt-text">${escapeHtml(prompts.faithfulness_judge)}</div>
      </section>` : ""}`;
  }

  /* ---- Versions (answer text) ---- */
  const versionText = v => textAt(state, v) ?? answer.final_answer;
  function showVersionText(v) {
    kit.setPanel({ type: "custom" });
    openModal(`Answer v${v}${v === 1 ? " — as generated" : ""}`, `<div class="md">${renderMarkdown(versionText(v))}</div>
      <div class="modal-foot"><button class="btn small" type="button" data-back-versions>${icon("back")} Version history</button></div>`, { wide: true });
  }
  function showVersionDiff(v) {
    kit.setPanel({ type: "custom" });
    openModal(`What changed in v${v}`, `<p class="section-note">Compared with v${v - 1}. <ins class="legend">Added</ins> <del class="legend">removed</del></p>
      ${diffHtml(versionText(v - 1), versionText(v))}
      <div class="modal-foot"><button class="btn small" type="button" data-back-versions>${icon("back")} Version history</button></div>`, { wide: true });
  }

  /* ---- Full editor ---- */
  function openEditor({ text, flagIds = [], note = "", hint = "" } = {}) {
    kit.setPanel({ type: "custom" });
    const open = state.flags.filter(f => f.status !== "fixed");
    const pre = new Set(flagIds);
    openModal(`Edit answer — saves as v${state.version + 1}`, `
      <div class="editor">
        ${hint ? `<div class="warn">${hint}</div>` : ""}
        <div class="seg" role="tablist">
          <button class="seg-btn active" type="button" data-ed-tab="write">Write</button>
          <button class="seg-btn" type="button" data-ed-tab="preview">Preview</button>
          <button class="seg-btn" type="button" data-ed-tab="diff-current">Changes vs v${state.version}</button>
          <button class="seg-btn" type="button" data-ed-tab="diff-original">Changes vs generated</button>
        </div>
        <textarea id="ed-text" class="ed-text" spellcheck="true">${escapeHtml(text ?? currentText())}</textarea>
        <div id="ed-out" class="ed-out md" hidden></div>
        <input type="text" id="ed-change" maxlength="500" placeholder="What did you change? (shown in the version history)" value="${escapeHtml(note)}">
        ${open.length ? `<div class="detail-h" style="margin:4px 0 0">Mark these flags fixed in this version</div>
          <div class="ed-flags">${open.map(f => `<label><input type="checkbox" data-ed-flag="${f.id}" ${pre.has(f.id) ? "checked" : ""}> ${escapeHtml(f.title)} <span class="muted small">${escapeHtml(f.anchor ? f.anchor.label : "General")}</span></label>`).join("")}</div>` : ""}
        <div class="qa-row">
          <span class="muted small">The generated answer is always kept as v1.</span>
          <button class="btn primary" id="ed-save" type="button">Save as v${state.version + 1}</button>
        </div>
        <p class="qa-error" id="ed-error"></p>
      </div>`, { wide: true });
    const ta = document.getElementById("ed-text");
    const out = document.getElementById("ed-out");
    ta.focus();
    document.querySelectorAll("[data-ed-tab]").forEach(b => b.addEventListener("click", () => {
      document.querySelectorAll("[data-ed-tab]").forEach(x => x.classList.toggle("active", x === b));
      const t = b.dataset.edTab;
      ta.hidden = t !== "write";
      out.hidden = t === "write";
      if (t === "preview") out.innerHTML = renderMarkdown(ta.value);
      if (t === "diff-current") out.innerHTML = diffHtml(currentText(), ta.value);
      if (t === "diff-original") out.innerHTML = diffHtml(answer.final_answer, ta.value);
    }));
    document.getElementById("ed-save").addEventListener("click", async e => {
      const btn = e.currentTarget;
      btn.disabled = true;
      try {
        const res = await applyReviewOp(answer.id, state, {
          op: "save_edit", text: ta.value,
          change: document.getElementById("ed-change").value.trim(),
          flag_ids: [...document.querySelectorAll("[data-ed-flag]:checked")].map(x => x.dataset.edFlag),
        });
        closeModal();
        view = "current";
        kit.selected.clear();
        onChanged();
        toast(`Saved as v${res.version}`);
      } catch (err) {
        document.getElementById("ed-error").textContent = `Couldn't save: ${err.message}`;
        btn.disabled = false;
      }
    });
  }
  function applySuggestion(flag) {
    const cur = currentText();
    const quote = flag.anchor && flag.anchor.quote;
    const idx = quote ? findLoose(cur, quote) : null;
    if (idx) openEditor({ text: cur.slice(0, idx.start) + flag.suggested_text + cur.slice(idx.end), flagIds: [flag.id], note: flag.title });
    else openEditor({ flagIds: [flag.id], note: flag.title, hint: `Couldn't find the quoted text in the current answer (it may contain formatting). Suggested rewrite: <em>${escapeHtml(flag.suggested_text)}</em>` });
  }
  /* Finds `quote` in markdown `text`, tolerating whitespace and bold/italic/code markup between words. */
  function findLoose(text, quote) {
    const exact = text.indexOf(quote);
    if (exact >= 0) return { start: exact, end: exact + quote.length };
    const words = quote.trim().split(/\s+/).map(w => w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
    const m = new RegExp(words.join("[\\s*_`]+")).exec(text);
    return m ? { start: m.index, end: m.index + m[0].length } : null;
  }

  /* ---- Revealing a spot (for flags and judge turn links) ---- */
  function switchTab(name) {
    container.querySelectorAll(".tab-btn").forEach(x => x.classList.toggle("active", x.dataset.tab === name));
    container.querySelectorAll(".tab-panel").forEach(x => x.classList.toggle("active", x.id === "tab-" + name));
  }
  function reveal(key) {
    if (key.startsWith("turn:") && !historyExpanded) { historyExpanded = true; renderConversation(); decorateAnchors(); }
    if (key.startsWith("answer") && !["current", "original"].includes(view)) { view = "current"; renderAnswerCard(); decorateAnchors(); }
    if ((key.startsWith("draft:") || key === "audit") && view !== "draft") { view = "draft"; renderAnswerCard(); decorateAnchors(); }
    if (key.startsWith("score:")) { const k = key.slice(6); if (!openScores.has(k)) { openScores.add(k); renderScores(); decorateAnchors(); } }
    const el = container.querySelector(`[data-anchor="${CSS.escape(key)}"]`);
    if (!el) return null;
    const panel = el.closest(".tab-panel");
    if (panel) switchTab(panel.id.replace("tab-", ""));
    if (el.tagName === "DETAILS") el.open = true;
    const det = el.closest("details");
    if (det) det.open = true;
    return el;
  }
  function gotoTurn(n) {
    const t = kindOfTurn[n];
    if (!t) return toast(`Turn ${n} isn't in this trace`);
    const key = t.kind === "history" || t.kind === "question" ? `turn:${n}`
      : t.kind === "tool" ? `tool:${t.index}`
      : t.kind === "system" ? "prompt:assistant"
      : t.kind === "faithfulness" ? "faith"
      : t.kind === "audit" ? "audit"
      : t.kind === "draft" && answer.revised ? "draft:b0"
      : "answer";
    let el = reveal(key);
    if (key === "draft:b0") el = container.querySelector(".answer-card");
    if (key === "answer" && view !== "current") { view = "current"; renderAnswerCard(); decorateAnchors(); el = reveal("answer"); }
    if (el) flashElement(el);
  }

  /* ---- Render ---- */
  function onChanged() {
    $("#review-strip").innerHTML = kit.stripHtml({ versionLabel: isEdited() ? "edited" : "as generated" });
    renderCtxBar();
    renderAnswerCard();
    renderScores();
    decorateAnchors();
  }
  renderHeader();
  renderConversation();
  renderTools();
  renderPrompts();
  renderScores();
  $("#review-strip").innerHTML = kit.stripHtml({ versionLabel: isEdited() ? "edited" : "as generated" });
  renderCtxBar();

  // The slim context bar appears once the question scrolls out of view.
  const io = new IntersectionObserver(([e]) => $("#ctx-bar").classList.toggle("show", !e.isIntersecting && e.boundingClientRect.top < 0), { rootMargin: "-60px 0px 0px 0px" });
  io.observe($(".question"));

  const flagCtx = {
    id: answer.id, state, onChanged, reveal,
    showFlagsPanel: p => kit.showFlagsPanel(p),
    viewVersion: () => view === "current" ? state.version : view === "original" ? 1 : null,
  };

  function handleClick(t) {
    const d = t.dataset || {};
    if (d.tab && t.classList.contains("tab-btn")) { switchTab(d.tab); return true; }
    if (d.view) { view = d.view; editingBlock = null; renderAnswerCard(); decorateAnchors(); return true; }
    if (d.editBlock) { editingBlock = Number(d.editBlock); renderAnswerCard(); decorateAnchors(); return true; }
    if (d.flagBlock) { const k = Number(d.flagBlock); openQuickAdd({ key: `answer:b${k}`, label: `Answer v${state.version} · paragraph ${k + 1}`, version: state.version }); return true; }
    if (d.ie === "cancel") { editingBlock = null; renderAnswerCard(); decorateAnchors(); return true; }
    if (d.ie === "save") { saveInlineEdit(); return true; }
    if (d.toggleScore) {
      openScores.has(d.toggleScore) ? openScores.delete(d.toggleScore) : openScores.add(d.toggleScore);
      renderScores(); decorateAnchors(); return true;
    }
    if (d.openScore) { const el = reveal(`score:${d.openScore}`); if (el) flashElement(el); return true; }
    if (d.gotoTurn) { closeModal(); gotoTurn(Number(d.gotoTurn)); return true; }
    switch (d.action) {
      case "edit-answer": openEditor(); return true;
      case "show-earlier": historyExpanded = true; renderConversation(); decorateAnchors(); return true;
      case "to-top": window.scrollTo({ top: 0, behavior: "smooth" }); return true;
      case "scale-info": openModal("How to read the judge scores", `<p class="scale-note">${SCALE_NOTE}</p>`); return true;
    }
    if (kit.handleClick(t)) return true;
    if (d.flagScore) {
      const r = rubrics.find(x => x.key === d.flagScore);
      openQuickAdd({ key: `score:${r.key}`, label: `Judge score: ${r.short}` }, { category: "Judge got it wrong" });
      return true;
    }
    if (d.humanLevel) {
      kit.saveOp(t, { op: "set_human_level", rubric: d.rubric, level: Number(d.humanLevel), note: (document.getElementById(`human-note-${d.rubric}`) || {}).value || "" }, "Your level is saved");
      return true;
    }
    if (d.clearHuman) { kit.saveOp(t, { op: "set_human_level", rubric: d.clearHuman, level: null }, "Cleared"); return true; }
    if (d.applySuggestion) { applySuggestion(state.flags.find(f => f.id === d.applySuggestion)); return true; }
    if (d.editForFlag) { const f = state.flags.find(x => x.id === d.editForFlag); openEditor({ flagIds: [f.id], note: f.title }); return true; }
    if (t.id === "edit-selected" && kit.selected.size) { openEditor({ flagIds: [...kit.selected] }); return true; }
    if (d.viewVersion) { showVersionText(Number(d.viewVersion)); return true; }
    if (d.diffVersion) { showVersionDiff(Number(d.diffVersion)); return true; }
    return false;
  }
  function handleKey(e) {
    if (e.key === "ArrowLeft" && prev) { location.hash = `answer=${prev.id}`; return true; }
    if (e.key === "ArrowRight" && next) { location.hash = `answer=${next.id}`; return true; }
    return false;
  }

  return {
    answer, state, flagCtx, handleClick, handleKey,
    questionKey: answer.question.trim().toLowerCase(),
    destroy() { io.disconnect(); },
  };
}
