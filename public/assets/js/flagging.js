/* Location-aware flagging (same model as Chart QA).

   Any element with data-anchor="<key>" (+ data-anchor-label) is a place a
   flag can be pinned to: conversation turns, the question, each answer
   paragraph, judge score cards, tool calls and the system prompts.
   Reviewers flag by selecting text and pressing the floating button, or by
   right-clicking; the selected text becomes the flag's quote. Anchors with
   flags get an "N open" badge, and flag cards jump back to their spot.

   The answer page and the patient profile both call
   initFlagging({ id, state, onChanged, showFlagsPanel, reveal, categories?, viewVersion? }) once;
   `id` is the review-state id the flags are saved under. Elements with a
   [data-flag-here] button inside an anchor flag that anchor in one click. */

let FLAG_CTX = null;

const ANSWER_FLAG_CATEGORIES = [
  "Clear reasoning", "Grounded in user data", "Grounded in research", "Asks for missing info", "Intent / need",
  "Safety", "Factual error", "Tone & style", "Judge got it wrong", "Other",
];
const PROFILE_FLAG_CATEGORIES = [
  "Wrong value", "Inconsistent with other data", "Missing information", "Outdated", "Implausible for this patient", "Unclear wording", "Other",
];

/* Sets the active flagging context (null switches flagging off); the
   document listeners are installed only once. */
function initFlagging(ctx) {
  FLAG_CTX = ctx;
  if (initFlagging.done) { decorateAnchors(); return; }
  initFlagging.done = true;
  document.addEventListener("contextmenu", onContextMenu);
  document.addEventListener("mouseup", () => setTimeout(updateSelectionButton, 0));
  let selTimer = null;
  document.addEventListener("selectionchange", () => { clearTimeout(selTimer); selTimer = setTimeout(updateSelectionButton, 180); });
  document.addEventListener("mousedown", e => {
    if (!e.target.closest(".ctx-menu")) closeContextMenu();
    if (!e.target.closest(".sel-flag-btn")) hideSelectionButton();
  });
  document.addEventListener("keydown", e => { if (e.key === "Escape") { closeContextMenu(); hideSelectionButton(); } });
  window.addEventListener("scroll", () => { closeContextMenu(); hideSelectionButton(); }, true);
  // Capture phase: badges sit inside buttons that would otherwise toggle.
  document.addEventListener("click", onBadgeClick, true);
  document.addEventListener("click", e => {
    const btn = e.target.closest && e.target.closest("[data-flag-here]");
    if (!btn || !FLAG_CTX) return;
    e.preventDefault();
    e.stopPropagation();
    const el = btn.closest("[data-anchor]");
    if (el) openQuickAdd(anchorFromElement(el));
  }, true);
  document.addEventListener("keydown", e => {
    if ((e.key === "Enter" || e.key === " ") && e.target.classList && e.target.classList.contains("loc-badge")) onBadgeClick(e);
  }, true);
  decorateAnchors();
}

function anchorFromElement(el, quote) {
  const anchor = { key: el.dataset.anchor, label: el.dataset.anchorLabel || el.dataset.anchor };
  if (quote) anchor.quote = quote;
  if (anchor.key.startsWith("answer:") && FLAG_CTX.viewVersion) anchor.version = FLAG_CTX.viewVersion();
  return anchor;
}
function anchorElementFor(node) {
  const el = node && (node.nodeType === 1 ? node : node.parentElement);
  return el ? el.closest("[data-anchor]") : null;
}

/* The part of the current selection inside `el` (clipped, so a triple-click
   that spills into the next element still works). */
function selectedTextIn(el) {
  const sel = window.getSelection();
  if (!sel || sel.isCollapsed || !el || !sel.rangeCount) return "";
  const range = sel.getRangeAt(0);
  const within = document.createRange();
  within.selectNodeContents(el);
  if (range.compareBoundaryPoints(Range.END_TO_START, within) >= 0 || range.compareBoundaryPoints(Range.START_TO_END, within) <= 0) return "";
  if (range.compareBoundaryPoints(Range.START_TO_START, within) > 0) within.setStart(range.startContainer, range.startOffset);
  if (range.compareBoundaryPoints(Range.END_TO_END, within) < 0) within.setEnd(range.endContainer, range.endOffset);
  return within.toString().replace(/\s+/g, " ").trim().slice(0, 2000);
}
function selectionAnchorElement(sel) {
  const range = sel.getRangeAt(0);
  return anchorElementFor(range.startContainer) || anchorElementFor(range.endContainer);
}

/* ---- Right-click menu ---- */
function onContextMenu(e) {
  if (!FLAG_CTX) return;
  if (e.target.closest(".ctx-menu, #modal-root, .top-bar, .review-strip, .block-tools, .item-flag, .inline-editor, input, textarea, select")) return;
  const el = anchorElementFor(e.target);
  if (!el) return; // outside flaggable content: keep the browser's menu
  e.preventDefault();
  const quote = selectedTextIn(el);
  const anchor = anchorFromElement(el, quote);
  closeContextMenu();
  const menu = document.createElement("div");
  menu.className = "ctx-menu";
  menu.innerHTML = `
    <button type="button" data-ctx="flag"><strong>Flag an issue here</strong>
      <span class="ctx-sub">${escapeHtml(anchor.label)}${quote ? " · with selected text" : ""}</span></button>
    ${quote ? `<button type="button" data-ctx="copy">Copy selected text</button>` : ""}`;
  document.body.appendChild(menu);
  const r = menu.getBoundingClientRect();
  menu.style.left = `${Math.min(e.clientX, innerWidth - r.width - 8)}px`;
  menu.style.top = `${Math.min(e.clientY, innerHeight - r.height - 8)}px`;
  menu.addEventListener("click", ev => {
    const btn = ev.target.closest("[data-ctx]");
    closeContextMenu();
    if (!btn) return;
    if (btn.dataset.ctx === "flag") openQuickAdd(anchor);
    if (btn.dataset.ctx === "copy" && navigator.clipboard) navigator.clipboard.writeText(quote).catch(() => {});
  });
}
function closeContextMenu() {
  document.querySelectorAll(".ctx-menu").forEach(m => m.remove());
}

/* ---- Floating "Flag" button on text selection ---- */
function updateSelectionButton() {
  if (!FLAG_CTX) { hideSelectionButton(); return; }
  const sel = window.getSelection();
  if (!sel || sel.isCollapsed || !sel.rangeCount || document.getElementById("modal-overlay")) { hideSelectionButton(); return; }
  const el = selectionAnchorElement(sel);
  const quote = selectedTextIn(el);
  if (!el || !quote) { hideSelectionButton(); return; }
  const rect = sel.getRangeAt(0).getBoundingClientRect();
  let btn = document.querySelector(".sel-flag-btn");
  if (!btn) {
    btn = document.createElement("button");
    btn.type = "button";
    btn.className = "sel-flag-btn";
    btn.textContent = "⚑ Flag this";
    btn.addEventListener("mousedown", e => e.preventDefault()); // keep the selection
    document.body.appendChild(btn);
  }
  btn.onclick = () => { const a = anchorFromElement(el, quote); hideSelectionButton(); openQuickAdd(a); };
  btn.style.left = `${Math.max(8, Math.min(rect.right - 110, innerWidth - 130))}px`;
  btn.style.top = `${rect.bottom + 6 > innerHeight - 40 ? rect.top - 38 : rect.bottom + 6}px`;
}
function hideSelectionButton() {
  document.querySelectorAll(".sel-flag-btn").forEach(b => b.remove());
}

/* ---- Quick add (also used by the top bar's "+" with no location) ---- */
function openQuickAdd(anchor, preset = {}) {
  const isAnswer = anchor && anchor.key.startsWith("answer:");
  openModal("Flag an issue", `
    <div class="quick-add">
      <div class="qa-loc">${anchor ? `Location: <strong>${escapeHtml(anchor.label)}</strong>` : "General — not tied to a spot"}</div>
      ${anchor && anchor.quote ? `<blockquote class="flag-quote">${escapeHtml(anchor.quote)}</blockquote>` : ""}
      <input type="text" id="qa-title" placeholder="What's wrong? (required)" maxlength="200" value="${escapeHtml(preset.title || "")}">
      <textarea id="qa-desc" rows="2" placeholder="Details (optional)"></textarea>
      <textarea id="qa-fix" rows="2" placeholder="Proposed fix (optional)"></textarea>
      ${isAnswer && anchor.quote ? `
        <label class="qa-label" for="qa-suggest">Suggested rewrite of the quoted text <span class="muted">(optional — can be applied as an edit later)</span></label>
        <textarea id="qa-suggest" rows="3" placeholder="How it should read instead">${escapeHtml(anchor.quote)}</textarea>` : ""}
      <div class="qa-row">
        <select id="qa-category" aria-label="Category">
          <option value="">Category…</option>
          ${(FLAG_CTX.categories || ANSWER_FLAG_CATEGORIES).map(c => `<option ${preset.category === c ? "selected" : ""}>${escapeHtml(c)}</option>`).join("")}
        </select>
        <select id="qa-urgency" aria-label="Urgency">
          <option value="High">High urgency</option>
          <option value="Medium" selected>Medium urgency</option>
          <option value="Low">Low urgency</option>
        </select>
        <button class="btn primary" id="qa-submit" type="button">Add flag</button>
      </div>
      <p class="qa-error" id="qa-error"></p>
    </div>`);
  const title = document.getElementById("qa-title");
  title.focus();
  const submit = async () => {
    const btn = document.getElementById("qa-submit");
    if (!title.value.trim()) { title.focus(); return; }
    const suggestEl = document.getElementById("qa-suggest");
    const suggested = suggestEl && suggestEl.value.trim() !== (anchor.quote || "").trim() ? suggestEl.value.trim() : "";
    btn.disabled = true;
    try {
      await applyReviewOp(FLAG_CTX.id, FLAG_CTX.state, {
        op: "add_flag",
        title: title.value.trim(),
        description: document.getElementById("qa-desc").value.trim(),
        proposed_fix: document.getElementById("qa-fix").value.trim(),
        suggested_text: suggested,
        category: document.getElementById("qa-category").value,
        severity: document.getElementById("qa-urgency").value,
        anchor: anchor || undefined,
      });
      closeModal();
      window.getSelection().removeAllRanges();
      FLAG_CTX.onChanged();
      toast("Flag added");
    } catch (e) {
      document.getElementById("qa-error").textContent = `Couldn't save: ${e.message}`;
      btn.disabled = false;
    }
  };
  document.getElementById("qa-submit").addEventListener("click", submit);
  title.addEventListener("keydown", e => { if (e.key === "Enter") submit(); });
}

/* ---- Per-location badges + quote highlights ---- */
function flagsByAnchor() {
  const map = {};
  (FLAG_CTX ? FLAG_CTX.state.flags : []).forEach(f => {
    if (f.anchor && f.anchor.key) (map[f.anchor.key] = map[f.anchor.key] || []).push(f);
  });
  return map;
}
function badgeHtml(flags, attrs) {
  const open = flags.filter(f => f.status !== "fixed").length;
  const text = open ? `${open} open` : `${flags.length} fixed`;
  return `<span class="loc-badge ${open ? "open" : "fixed"}" role="button" tabindex="0" title="Show these flags" ${attrs}>⚑ ${text}</span>`;
}
function unwrapMarks(root) {
  root.querySelectorAll("mark.flag-mark").forEach(m => m.replaceWith(...m.childNodes));
  root.normalize();
}
function highlightQuote(el, quote) {
  const candidates = [quote.trim(), quote.replace(/\s+/g, " ").trim()];
  const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT, {
    acceptNode: n => n.parentElement.closest(".loc-badge, mark, .badge-slot, .block-tools, .item-flag") ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT,
  });
  let node;
  while ((node = walker.nextNode())) {
    for (const needle of candidates) {
      const i = needle.length > 1 ? node.nodeValue.indexOf(needle) : -1;
      if (i >= 0) {
        const range = document.createRange();
        range.setStart(node, i);
        range.setEnd(node, i + needle.length);
        const mark = document.createElement("mark");
        mark.className = "flag-mark";
        range.surroundContents(mark);
        return;
      }
    }
  }
}
/* The element's own .badge-slot (not one belonging to a nested anchor). */
function badgeSlot(el) {
  return [...el.querySelectorAll(".badge-slot")].find(s => s.closest("[data-anchor]") === el) || el;
}

function decorateAnchors() {
  if (!FLAG_CTX) return;
  document.querySelectorAll(".loc-badge").forEach(b => b.remove());
  document.querySelectorAll("[data-anchor]").forEach(unwrapMarks);
  const byKey = flagsByAnchor();
  document.querySelectorAll("[data-anchor]").forEach(el => {
    const key = el.dataset.anchor;
    (byKey[key] || []).forEach(f => {
      if (f.anchor.quote && f.status !== "fixed") highlightQuote(el, f.anchor.quote);
    });
    // Count this spot plus anything nested in it, so a collapsed part still shows where to look.
    const keys = [key, ...[...el.querySelectorAll("[data-anchor]")].map(c => c.dataset.anchor)];
    const flags = keys.flatMap(k => byKey[k] || []);
    if (!flags.length) return;
    badgeSlot(el).insertAdjacentHTML("beforeend", badgeHtml(flags, `data-loc-keys="${escapeHtml(keys.join("|"))}" data-loc-label="${escapeHtml(el.dataset.anchorLabel || key)}"`));
  });
}

function onBadgeClick(e) {
  const badge = e.target.closest && e.target.closest(".loc-badge");
  if (!badge || !FLAG_CTX) return;
  e.preventDefault();
  e.stopPropagation();
  FLAG_CTX.showFlagsPanel({ type: "location", keys: badge.dataset.locKeys.split("|"), title: badge.dataset.locLabel });
}

/* ---- Jump from a flag card to where it was raised ---- */
function goToFlagLocation(flag) {
  closeModal();
  if (!flag || !flag.anchor) return;
  const el = FLAG_CTX.reveal(flag.anchor.key);
  if (!el) {
    openModal("Where this was flagged", `
      <div class="qa-loc">${escapeHtml(flag.anchor.label)} — that spot isn't on the page any more (the answer may have been edited since).</div>
      ${flag.anchor.quote ? `<blockquote class="flag-quote">${escapeHtml(flag.anchor.quote)}</blockquote>` : ""}`);
    return;
  }
  flashElement(el);
}
function flashElement(el) {
  el.scrollIntoView({ behavior: "smooth", block: "center" });
  el.classList.remove("flash");
  void el.offsetWidth; // restart the animation
  el.classList.add("flash");
  setTimeout(() => el.classList.remove("flash"), 2400);
}
