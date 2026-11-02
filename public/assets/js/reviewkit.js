/* The review machinery shared by the answer page and the patient profile:
   the review strip, flag lists (with batch "mark fixed"), comments, the bin,
   version history with roll-back, and saving operations.

   const kit = createReviewKit({ id, state, onChanged, noun, ...hooks });
   kit.handleClick(target) returns true when it handled a click. */

function createReviewKit(opts) {
  const { id, state } = opts;
  const noun = opts.noun || "answer";
  const selected = new Set();
  let panel = null;

  async function saveOp(button, op, msg) {
    if (button && button.disabled) return;
    if (button) button.disabled = true;
    try {
      const res = await applyReviewOp(id, state, op);
      opts.onChanged();
      refreshPanelIfOpen();
      if (msg) toast(typeof msg === "function" ? msg(res) : msg);
      return res;
    } catch (e) {
      toast(`Couldn't save: ${e.message}`);
      opts.onChanged();
    } finally {
      if (button) button.disabled = false;
    }
  }

  function stripHtml({ versionLabel } = {}) {
    const c = flagCounts(state);
    const notes = Object.values(state.comments).reduce((a, arr) => a + arr.length, 0);
    return `<div class="review-strip">
      <button class="rs-stat open" type="button" data-action="show-open"><span class="num">${c.open}</span> open flags</button>
      <button class="rs-stat fixed" type="button" data-action="show-fixed"><span class="num">${c.fixed}</span> fixed</button>
      <span class="rs-stat"><span class="num">${notes}</span> comments</span>
      <span class="rs-div"></span>
      <button class="rs-stat" type="button" data-action="versions" title="Version history"><span class="num">v${state.version}</span> ${escapeHtml(versionLabel || "")}</button>
      <span class="rs-right">
        <button class="btn small ghost" type="button" data-action="versions">${icon("history")} History</button>
        <button class="btn small ghost" type="button" data-action="bin">${icon("bin")} Bin${state.bin.length ? ` (${state.bin.length})` : ""}</button>
        <button class="btn small" type="button" data-action="flag-general">${icon("flag")} Flag an issue</button>
      </span>
    </div>`;
  }

  function flagCardHtml(f, selectable) {
    const sev = f.severity === "High" ? "rust" : f.severity === "Medium" ? "amber" : "";
    const comments = state.comments[f.id] || [];
    return `<div class="flag-card" data-flag="${f.id}">
      <div class="flag-head">
        ${selectable ? `<input type="checkbox" class="flag-select" data-select-flag="${f.id}" aria-label="Select ${escapeHtml(f.title)}" ${selected.has(f.id) ? "checked" : ""}>` : ""}
        ${f.anchor ? `<button class="flag-title linklike" data-goto-flag="${f.id}" type="button" title="Go to where this was flagged">${escapeHtml(f.title)}</button>`
          : `<span class="flag-title">${escapeHtml(f.title)}</span>`}
        <span class="tag ${f.status === "fixed" ? "teal" : "rust"}">${f.status === "fixed" ? `Fixed in v${f.fixed_in_version}` : "Open"}</span>
      </div>
      <div class="flag-loc">${f.anchor ? `${escapeHtml(f.anchor.label)} · <button class="linklike" data-goto-flag="${f.id}" type="button">Go to location ›</button>` : "General — no specific location"}</div>
      ${f.anchor && f.anchor.quote ? `<blockquote class="flag-quote">${escapeHtml(f.anchor.quote)}</blockquote>` : ""}
      ${f.description ? `<div class="flag-desc">${escapeHtml(f.description)}</div>` : ""}
      ${f.proposed_fix ? `<div class="flag-desc"><strong>Proposed fix:</strong> ${escapeHtml(f.proposed_fix)}</div>` : ""}
      ${f.suggested_text ? `<div class="flag-desc"><strong>Suggested rewrite:</strong><div class="suggest">${escapeHtml(f.suggested_text)}</div></div>` : ""}
      <div class="flag-tags"><span class="tag ${sev}">${escapeHtml(f.severity)} urgency</span>${f.category ? `<span class="tag">${escapeHtml(f.category)}</span>` : ""}</div>
      <div class="flag-audit">Flagged by ${escapeHtml(f.opened_by)} · ${escapeHtml(fmtDateTime(f.opened_date))}${f.status === "fixed" ? ` — fixed by ${escapeHtml(f.fixed_by)} · ${escapeHtml(fmtDateTime(f.fixed_date))}` : ""}</div>
      ${comments.length ? `<div class="flag-comments">${comments.map(c => `<div class="flag-comment"><span class="who">${escapeHtml(c.who)}</span> · ${escapeHtml(fmtDateTime(c.date))}: ${escapeHtml(c.text)}</div>`).join("")}</div>` : ""}
      <div class="flag-actions">
        ${f.status !== "fixed" && opts.flagActions ? opts.flagActions(f) : ""}
        <button class="btn small" data-comment-toggle="${f.id}" type="button">${icon("comment")} Comment</button>
        ${f.status !== "fixed" ? `<button class="btn small btn-danger" data-delete-flag="${f.id}" type="button">Delete</button>` : ""}
      </div>
      <div class="comment-input-row" id="comment-row-${f.id}" hidden>
        <input type="text" class="field" placeholder="Add a comment…" id="comment-input-${f.id}">
        <button class="btn small" data-submit-comment="${f.id}" type="button">Post</button>
      </div>
    </div>`;
  }

  function showFlagsPanel(p) {
    panel = p;
    const flags = p.type === "location"
      ? state.flags.filter(f => f.anchor && p.keys.includes(f.anchor.key)).sort((a, b) => (a.status === "fixed") - (b.status === "fixed"))
      : state.flags.filter(f => p.type === "open" ? f.status !== "fixed" : f.status === "fixed");
    const openIds = new Set(flags.filter(f => f.status !== "fixed").map(f => f.id));
    [...selected].forEach(fid => { if (!openIds.has(fid)) selected.delete(fid); });
    let body = flags.length ? flags.map(f => flagCardHtml(f, f.status !== "fixed")).join("")
      : `<div class="empty-note">${p.type === "open" ? opts.emptyOpenHint || "No open flags." : "Nothing here yet."}</div>`;
    if (openIds.size) {
      const n = selected.size;
      body = `<div class="fix-bar">
          <label class="fix-bar-all"><input type="checkbox" id="select-all-flags" ${n && n === openIds.size ? "checked" : ""}> Select all open</label>
          ${opts.fixBarExtra ? opts.fixBarExtra(n) : ""}
          <button class="btn primary small" id="mark-fixed" type="button" ${n ? "" : "disabled"}>${n ? `Mark ${n} fixed` : "Mark fixed"}</button>
        </div>
        <p class="section-note">Fixes marked together count as one new ${escapeHtml(noun)} version.</p>` + body;
    }
    openModal(p.type === "open" ? "Open flags" : p.type === "fixed" ? "Fixed flags" : p.title, body, { wide: true });
  }
  function updateFixBar() {
    const n = selected.size;
    const fix = document.getElementById("mark-fixed");
    if (fix) { fix.disabled = !n; fix.textContent = n ? `Mark ${n} fixed` : "Mark fixed"; }
    if (opts.onSelectionChange) opts.onSelectionChange(n);
    const all = document.getElementById("select-all-flags");
    const boxes = document.querySelectorAll("[data-select-flag]");
    if (all) all.checked = boxes.length > 0 && n === boxes.length;
  }
  function refreshPanelIfOpen() {
    if (!panel || !document.getElementById("modal-overlay")) return;
    if (panel.type === "bin") showBin();
    else if (panel.type === "versions") showVersions();
    else if (panel.type !== "custom") showFlagsPanel(panel);
  }
  function showBin() {
    panel = { type: "bin" };
    const bin = [...state.bin].reverse();
    openModal("Bin", bin.length
      ? `<p class="section-note">Deleted flags, with their comments. Restore one to put it back in open flags.</p>` +
        bin.map(({ flag: f, comments, deleted_by, deleted_date }) => `<div class="flag-card">
          <div class="flag-head"><span class="flag-title">${escapeHtml(f.title)}</span><span class="tag">Deleted</span></div>
          <div class="flag-loc">${f.anchor ? escapeHtml(f.anchor.label) : "General — no specific location"}</div>
          ${f.anchor && f.anchor.quote ? `<blockquote class="flag-quote">${escapeHtml(f.anchor.quote)}</blockquote>` : ""}
          ${f.description ? `<div class="flag-desc">${escapeHtml(f.description)}</div>` : ""}
          <div class="flag-audit">Flagged by ${escapeHtml(f.opened_by)} · ${escapeHtml(fmtDateTime(f.opened_date))} — deleted by ${escapeHtml(deleted_by)} · ${escapeHtml(fmtDateTime(deleted_date))}${comments.length ? ` · ${plural(comments.length, "comment")}` : ""}</div>
          <div class="flag-actions">
            <button class="btn primary small" data-restore-flag="${f.id}" type="button">Restore</button>
            <button class="btn small btn-danger" data-purge-flag="${f.id}" type="button">Delete forever</button>
          </div>
        </div>`).join("")
      : `<div class="empty-note">The bin is empty.</div>`);
  }

  const KIND_LABEL = { generated: opts.firstVersionKind || "Generated", fix: "Fixes", edit: "Edit", rollback: "Roll-back" };
  function showVersions() {
    panel = { type: "versions" };
    openModal("Version history", `
      <p class="section-note">${escapeHtml(opts.versionNote || "")}</p>
      <ul class="version-list">
        ${[...state.versions].reverse().map(v => `<li class="version-row">
          <div class="v-main">
            <strong class="mono">v${v.version}</strong> <span class="tag">${KIND_LABEL[v.kind] || v.kind}</span> ${escapeHtml(v.version === 1 && opts.firstVersionChange ? opts.firstVersionChange : v.change)}
            <div class="section-note" style="margin:3px 0 0">${v.version === 1 ? escapeHtml(opts.firstVersionMeta || "") : `${escapeHtml(v.by)} · ${escapeHtml(fmtDateTime(v.date))}`}
              ${v.flag_ids.length ? ` · ${v.kind === "rollback" ? "reopened" : "fixed"} ${plural(v.flag_ids.length, "flag")}` : ""}</div>
          </div>
          <div class="v-actions">
            ${opts.versionActions ? opts.versionActions(v) : ""}
            ${v.version === state.version ? `<span class="tag teal">Current</span>` : `<button class="btn small" data-revert-version="${v.version}" type="button">Roll back to v${v.version}</button>`}
          </div>
        </li>`).join("")}
      </ul>`, { wide: true });
  }

  /* Generic clicks; returns true if handled. */
  function handleClick(t) {
    const d = t.dataset || {};
    switch (d.action) {
      case "flag-general": openQuickAdd(null); return true;
      case "show-open": showFlagsPanel({ type: "open" }); return true;
      case "show-fixed": showFlagsPanel({ type: "fixed" }); return true;
      case "versions": showVersions(); return true;
      case "bin": showBin(); return true;
    }
    if (d.commentToggle) {
      const row = document.getElementById("comment-row-" + d.commentToggle);
      row.hidden = !row.hidden;
      if (!row.hidden) row.querySelector("input").focus();
      return true;
    }
    if (d.submitComment) {
      const input = document.getElementById("comment-input-" + d.submitComment);
      if (input.value.trim()) saveOp(t, { op: "add_comment", flag_id: d.submitComment, text: input.value.trim() }, "Comment posted");
      return true;
    }
    if (d.gotoFlag) { goToFlagLocation(state.flags.find(f => f.id === d.gotoFlag)); return true; }
    if (d.deleteFlag) {
      const flag = state.flags.find(f => f.id === d.deleteFlag);
      if (!flag || !confirm(`Delete "${flag.title}"?\n\nUse this when it turns out not to be a real issue. It moves to the Bin, where anyone can restore it.`)) return true;
      selected.delete(flag.id);
      saveOp(t, { op: "delete_flag", flag_id: flag.id }, "Moved to the bin");
      return true;
    }
    if (d.restoreFlag) { saveOp(t, { op: "restore_flag", flag_id: d.restoreFlag }, "Restored"); return true; }
    if (d.purgeFlag) {
      const entry = state.bin.find(b => b.flag.id === d.purgeFlag);
      if (entry && confirm(`Permanently delete "${entry.flag.title}"?\n\nThis can't be undone.`)) saveOp(t, { op: "purge_flag", flag_id: entry.flag.id });
      return true;
    }
    if (d.selectFlag) {
      t.checked ? selected.add(d.selectFlag) : selected.delete(d.selectFlag);
      updateFixBar();
      return true;
    }
    if (t.id === "select-all-flags") {
      document.querySelectorAll("[data-select-flag]").forEach(box => {
        box.checked = t.checked;
        t.checked ? selected.add(box.dataset.selectFlag) : selected.delete(box.dataset.selectFlag);
      });
      updateFixBar();
      return true;
    }
    if (t.id === "mark-fixed" && selected.size) {
      const ids = [...selected];
      selected.clear();
      saveOp(t, { op: "fix_flags", flag_ids: ids }, res => `Marked fixed as v${res.version}`);
      return true;
    }
    if ("backVersions" in d) { showVersions(); return true; }
    if (d.revertVersion) {
      const target = Number(d.revertVersion);
      const reopen = state.flags.filter(f => f.status === "fixed" && f.fixed_in_version > target).length;
      if (confirm(`Roll back to v${target}?\n\nThis adds v${state.version + 1}${opts.rollbackDetail ? ` ${opts.rollbackDetail(target)}` : ""}${reopen ? ` and reopens ${plural(reopen, "fixed flag")}` : ""}. Nothing is deleted.`)) {
        saveOp(t, { op: "revert_to_version", version: target }, res => `Rolled back — now v${res.version}`);
      }
      return true;
    }
    return false;
  }

  return { saveOp, stripHtml, showFlagsPanel, showBin, showVersions, refreshPanelIfOpen, handleClick, selected, setPanel: p => (panel = p) };
}
