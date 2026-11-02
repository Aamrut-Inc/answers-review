/* A patient's space (patient.html?p=<n>#profile | #questions | #activity | #answer=<id>).

   Everything about one patient lives in this one page, so moving between the
   profile, the question list and an answer is a same-document view
   transition: the sidebar folds into a rail, the question title glides into
   the answer header, and content cross-fades. Browsers without view
   transitions get a short fade instead. */

(async function () {
  const n = Number(getParam("p")) || 1;
  const [patients, index, states, prompts] = await Promise.all([
    loadJSON("data/patients.json"), loadJSON("data/index.json"), getAllStates(), loadJSON("data/prompts.json"), loadIdentity(),
  ]);
  const card = patients.find(x => x.n === n) || patients[0];
  const profileId = `patient-${card.n}`;
  const [profile, profileState] = await Promise.all([loadJSON(`data/patients/${card.n}.json`), getAnswerState(profileId)]);
  states[profileId] = profileState;
  mountTopBar("patients");
  document.title = `${profile.name} — Answer QA`;

  const rubrics = index.rubrics;
  const batchOrder = Object.fromEntries(index.batches.map((b, i) => [b.id, i]));
  const answers = index.answers.filter(a => a.profile.n === card.n);
  const isScored = a => Object.keys(a.rubric_latest).length > 0;
  const reduceMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;

  /* Questions, in first-asked order; each with its runs by batch then persona. */
  const groups = [];
  const byKey = {};
  answers.slice().sort((a, b) => a.created.localeCompare(b.created)).forEach(a => {
    const k = a.question.trim().toLowerCase();
    if (!byKey[k]) groups.push(byKey[k] = { key: k, question: a.question.trim(), runs: [] });
    byKey[k].runs.push(a);
  });
  groups.forEach(g => g.runs.sort((x, y) => (batchOrder[x.batch] - batchOrder[y.batch]) || (x.persona || "").localeCompare(y.persona || "")));
  const ordered = groups.flatMap(g => g.runs);

  const sideEl = document.getElementById("p-side");
  const mainEl = document.getElementById("p-main");
  const layoutEl = document.getElementById("patient-layout");
  let current = { type: null };
  let view = null; // the live view: { handleClick, handleKey, flagCtx, destroy, questionKey }

  /* ---------- Sidebar (full, or a rail while reading an answer) ---------- */
  function openFlagsTotal() {
    return answers.reduce((s, a) => s + flagCounts(states[a.id]).open, 0) + flagCounts(profileState).open;
  }
  function renderSide(route) {
    const active = route.type === "answer" ? "questions" : route.type;
    const open = openFlagsTotal();
    const nav = [
      ["profile", "user", "Profile", flagCounts(profileState).open ? `<span class="count rust">${flagCounts(profileState).open}</span>` : ""],
      ["questions", "chat", "Questions & answers", `<span class="count">${groups.length}</span>`],
      ["activity", "activity", "Review activity", ""],
    ];
    sideEl.innerHTML = `<div class="card side-card">
      <a class="side-back" href="index.html">${icon("back")}<span class="nav-label">All patients</span></a>
      <div class="p-id">
        <a href="#profile" class="p-badge-link" title="${escapeHtml(profile.name)} — profile">${monogram(profile, "lg", "patient-badge")}</a>
        <div class="p-id-text">
          <h1 style="view-transition-name: patient-name">${escapeHtml(profile.name)}</h1>
          <div class="pc-sub">${escapeHtml(profile.age_sex)} · patient #${profile.n}</div>
          <span class="tag accent">${escapeHtml(profile.tag)}</span>
          <select class="field p-switch" id="p-switch" aria-label="Switch patient">
            ${patients.map(p => `<option value="${p.n}" ${p.n === card.n ? "selected" : ""}>${p.n} · ${escapeHtml(p.name)} — ${escapeHtml(p.tag)}</option>`).join("")}
          </select>
        </div>
      </div>
      <nav class="p-nav" aria-label="Patient sections">
        ${nav.map(([k, ic, label, extra]) => `<a href="#${k}" class="${active === k ? "active" : ""}" title="${escapeHtml(label)}">${icon(ic)}<span class="nav-label">${escapeHtml(label)}</span>${extra}</a>`).join("")}
      </nav>
      <div class="p-stats">
        <div><div class="num">${answers.length}</div><div class="lbl">answers</div></div>
        <div><div class="num">${answers.filter(isScored).length}</div><div class="lbl">scored</div></div>
        <div><div class="num ${open ? "rust" : ""}">${open}</div><div class="lbl">open flags</div></div>
      </div>
    </div>`;
    document.getElementById("p-switch").addEventListener("change", e => smoothNavigate(patientUrl(e.target.value, active === "questions" ? "questions" : active)));
  }

  /* ---------- Profile ---------- */
  const profileKit = createReviewKit({
    id: profileId, state: profileState, noun: "profile",
    onChanged: () => { renderProfileStrip(); decorateAnchors(); renderSide(current); },
    emptyOpenHint: "No open flags on this profile. Hover any item and click ⚑, or select text, to raise one.",
    firstVersionKind: "Imported",
    firstVersionChange: "Profile as imported from Chart QA",
    firstVersionMeta: `Chart data through ${fmtDate(profile.as_of)}`,
    versionNote: "Each time flags are marked fixed together the profile gets a new version. Rolling back reopens flags fixed after that version; nothing is deleted.",
  });
  function renderProfileStrip() {
    const el = document.getElementById("profile-strip");
    if (el) el.innerHTML = profileKit.stripHtml({ versionLabel: "profile" });
  }
  function profileView() {
    mainEl.innerHTML = `<div class="view-head">
        <div><div class="label">Patient profile</div><h2 class="view-title">${escapeHtml(profile.name)}</h2></div>
        <p class="view-hint">${icon("flag")} Hover any item and click the flag, or select text, to flag it. Flags are shared with the team.</p>
      </div>
      <div id="profile-strip"></div>
      <div class="profile-body">${renderProfile(profile, { flaggable: true })}</div>`;
    renderProfileStrip();
    const reveal = key => {
      const el = mainEl.querySelector(`[data-anchor="${CSS.escape(key)}"]`);
      if (!el) return null;
      const det = el.closest("details");
      if (det) det.open = true;
      return el;
    };
    return {
      flagCtx: { id: profileId, state: profileState, categories: PROFILE_FLAG_CATEGORIES, reveal,
        onChanged: () => { renderProfileStrip(); decorateAnchors(); renderSide(current); },
        showFlagsPanel: p => profileKit.showFlagsPanel(p) },
      handleClick: t => profileKit.handleClick(t),
    };
  }

  /* ---------- Questions ---------- */
  const prefs = (() => { try { return JSON.parse(localStorage.getItem("ar_q_prefs") || "{}"); } catch (e) { return {}; } })();
  const batchesHere = index.batches.filter(b => answers.some(a => a.batch === b.id));
  function statusChips(a) {
    const s = states[a.id];
    const c = flagCounts(s);
    const chips = [];
    if (s && s.versions.some(v => v.kind === "edit")) chips.push(`<span class="tag amber">${icon("edit")} edited · v${s.version}</span>`);
    if (c.open) chips.push(`<span class="tag rust">${icon("flag")} ${c.open} open</span>`);
    else if (c.fixed) chips.push(`<span class="tag accent">${icon("check")} ${c.fixed} fixed</span>`);
    if (!isScored(a)) chips.push(`<span class="tag" title="${a.scoring.status === "failed" ? "Every judge run failed" : "Not sent to the judges"}">${a.scoring.status === "failed" ? "judge failed" : "not judged"}</span>`);
    return chips.join("");
  }
  function questionsView() {
    mainEl.innerHTML = `<div class="view-head">
        <div><div class="label">Questions &amp; answers</div><h2 class="view-title">${plural(groups.length, "question")} · ${plural(answers.length, "answer")}</h2></div>
        <p class="view-hint">Each row is one answer to the question — from a batch (pipeline config) and persona. Click to open it.</p>
      </div>
      <div class="q-tools">
        <input type="search" class="field search" id="q-search" placeholder="Search this patient's questions…" aria-label="Search questions">
        <select class="field" id="q-batch" aria-label="Batch"><option value="">All batches</option>
          ${batchesHere.map(b => `<option value="${escapeHtml(b.id)}">${escapeHtml(b.id)}</option>`).join("")}</select>
        <label class="toggle"><input type="checkbox" id="q-scored"> Judge-scored only</label>
        <label class="toggle"><input type="checkbox" id="q-open"> Open flags only</label>
      </div>
      <div id="q-list"></div>`;
    const bs = document.getElementById("q-batch");
    if (prefs.batch && batchesHere.some(b => b.id === prefs.batch)) bs.value = prefs.batch;
    document.getElementById("q-scored").checked = !!prefs.scored;
    const draw = () => {
      const q = document.getElementById("q-search").value.trim().toLowerCase();
      const onlyScored = document.getElementById("q-scored").checked;
      const onlyOpen = document.getElementById("q-open").checked;
      const shown = groups.map(g => ({
        ...g, runs: g.runs.filter(a => (!bs.value || a.batch === bs.value) && (!onlyScored || isScored(a)) && (!onlyOpen || flagCounts(states[a.id]).open)),
      })).filter(g => g.runs.length && (!q || g.question.toLowerCase().includes(q)));
      document.getElementById("q-list").innerHTML = shown.length ? shown.map(g => `
        <section class="card q-group">
          <div class="q-head"><h3 data-qkey="${escapeHtml(g.key)}">${escapeHtml(g.question)}</h3><span class="n">${plural(g.runs.length, "answer")}</span></div>
          ${g.runs.map(a => `<a class="run" href="#answer=${a.id}">
            <span class="rb" title="${escapeHtml(a.batch)}">${escapeHtml(a.batch)}${a.persona ? `<span class="persona">· ${escapeHtml(a.persona)}</span>` : ""}</span>
            <span class="rm">${miniLevels(rubrics, a.rubric_latest)}</span>
            <span class="rs">${statusChips(a)}</span>
            <span class="chev">${icon("next")}</span>
          </a>`).join("")}
        </section>`).join("") : `<div class="card section-body empty-note">No questions match these filters.</div>`;
    };
    ["q-search", "q-batch", "q-scored", "q-open"].forEach(fid => document.getElementById(fid).addEventListener(fid === "q-search" ? "input" : "change", () => {
      try { localStorage.setItem("ar_q_prefs", JSON.stringify({ batch: bs.value, scored: document.getElementById("q-scored").checked })); } catch (e) { /* ignore */ }
      draw();
    }));
    draw();
    return { flagCtx: null, handleClick: () => false };
  }

  /* ---------- Activity ---------- */
  function activityView() {
    const events = buildEvents(answers, states, rubrics);
    profileState.flags.forEach(f => events.push({ date: f.opened_date, who: f.opened_by, icon: "flag", html: `flagged <em>${escapeHtml(f.title)}</em> on the <a href="#profile">profile</a>` }));
    profileState.versions.filter(v => v.version > 1).forEach(v => events.push({ date: v.date, who: v.by, icon: "check", html: `marked profile fixes <span class="muted">→ v${v.version}</span>` }));
    Object.values(profileState.comments).forEach(list => list.forEach(c => events.push({ date: c.date, who: c.who, icon: "comment", html: `commented on the <a href="#profile">profile</a>: <em>${escapeHtml(truncate(c.text, 90))}</em>` })));
    events.sort((x, y) => (y.date || "").localeCompare(x.date || ""));
    mainEl.innerHTML = `<div class="view-head">
        <div><div class="label">Review activity</div><h2 class="view-title">What the team has done</h2></div>
        <p class="view-hint">Flags, edits, fixes, comments and reviewer levels on ${escapeHtml(profile.name)}'s profile and answers.</p>
      </div>
      <section class="card section"><div class="section-body">${activityHtml(events, 80)}</div></section>`;
    return { flagCtx: null, handleClick: () => false };
  }

  /* ---------- Answer ---------- */
  async function answerView(id) {
    mainEl.innerHTML = `<div class="answer-view"></div>`;
    const v = await createAnswerView({ container: mainEl.firstElementChild, id, index, prompts, patient: profile, ordered });
    states[id] = v.state;
    return v;
  }

  /* ---------- Routing with view transitions ---------- */
  function parseRoute() {
    const h = decodeURIComponent(location.hash.slice(1));
    if (h.startsWith("answer=") && index.answers.some(a => a.id === h.slice(7) && a.profile.n === card.n)) return { type: "answer", id: h.slice(7) };
    return { type: ["profile", "questions", "activity"].includes(h) ? h : "profile" };
  }
  async function renderRoute(route) {
    if (view && view.destroy) view.destroy();
    closeModal();
    closeSnapshot();
    layoutEl.classList.toggle("is-rail", route.type === "answer");
    renderSide(route);
    view = route.type === "profile" ? profileView()
      : route.type === "questions" ? questionsView()
      : route.type === "activity" ? activityView()
      : await answerView(route.id);
    initFlagging(view.flagCtx);
    document.title = route.type === "answer" ? `${truncate(view.answer.question, 50)} — ${profile.name}` : `${profile.name} — Answer QA`;
  }
  let busy = Promise.resolve();
  async function go(route, { first = false } = {}) {
    const from = current;
    current = route;
    const backToQuestion = from.type === "answer" && route.type === "questions" && view ? view.questionKey : null;
    const render = async () => {
      await renderRoute(route);
      if (backToQuestion) {
        const h3 = mainEl.querySelector(`h3[data-qkey="${CSS.escape(backToQuestion)}"]`);
        if (h3) { h3.style.viewTransitionName = "question-title"; h3.scrollIntoView({ block: "center" }); }
      } else if (!first) window.scrollTo({ top: 0 });
    };
    if (first || reduceMotion || !document.startViewTransition) {
      mainEl.classList.remove("fade-in"); void mainEl.offsetWidth; mainEl.classList.add("fade-in");
      return render();
    }
    // Name the question being opened so it glides into the answer header.
    if (route.type === "answer" && from.type === "questions") {
      const key = (index.answers.find(a => a.id === route.id) || {}).question;
      const h3 = key && mainEl.querySelector(`h3[data-qkey="${CSS.escape(key.trim().toLowerCase())}"]`);
      if (h3) h3.style.viewTransitionName = "question-title";
    }
    const order = ["profile", "questions", "answer", "activity"];
    document.documentElement.dataset.nav = order.indexOf(route.type) >= order.indexOf(from.type) ? "forward" : "back";
    const t = document.startViewTransition(render);
    try { await t.finished; } catch (e) { /* skipped */ }
    mainEl.querySelectorAll("h3[data-qkey]").forEach(h => (h.style.viewTransitionName = ""));
  }
  window.addEventListener("hashchange", () => { busy = busy.then(() => go(parseRoute())); });

  /* ---------- Patient snapshot (answer view) ---------- */
  function openSnapshot() {
    const sheet = document.getElementById("sheet");
    sheet.innerHTML = `<div class="sheet-head">${monogram(profile)}<div style="flex:1;min-width:0"><h3>${escapeHtml(profile.name)}</h3>
        <div class="muted small">${escapeHtml(profile.age_sex)} · ${escapeHtml(profile.tag)}</div></div>
        <a class="btn small" href="#profile">Full profile</a>
        <button class="icon-btn" type="button" data-action="close-sheet" aria-label="Close">${icon("close")}</button></div>
      <div class="sheet-body">${renderProfile(profile, { compact: true })}</div>`;
    sheet.classList.add("open");
    document.getElementById("sheet-overlay").classList.add("open");
    sheet.setAttribute("aria-hidden", "false");
  }
  function closeSnapshot() {
    document.getElementById("sheet").classList.remove("open");
    document.getElementById("sheet-overlay").classList.remove("open");
    document.getElementById("sheet").setAttribute("aria-hidden", "true");
  }
  document.getElementById("sheet-overlay").addEventListener("click", closeSnapshot);

  /* ---------- Delegated input ---------- */
  document.addEventListener("click", e => {
    const t = e.target.closest("button, a, input");
    if (!t) return;
    if (t.dataset.action === "snapshot") { openSnapshot(); return; }
    if (t.dataset.action === "close-sheet") { closeSnapshot(); return; }
    if (t.matches(".sheet a[href^='#']")) closeSnapshot();
    if (view && view.handleClick) view.handleClick(t, e);
  });
  document.addEventListener("keydown", e => {
    if (e.key === "Escape" && document.getElementById("sheet").classList.contains("open")) { closeSnapshot(); return; }
    if (e.altKey || e.ctrlKey || e.metaKey || e.target.closest("input, textarea, select, [contenteditable]")) return;
    if (document.getElementById("modal-overlay")) return;
    if (view && view.handleKey) view.handleKey(e);
  });

  await go(parseRoute(), { first: true });
  document.body.classList.add("ready");
})().catch(showLoadError);
