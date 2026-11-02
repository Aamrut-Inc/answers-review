/* Home (index.html): every patient as a card. */

(async function () {
  if (getParam("answer")) { location.replace(answerUrl(getParam("answer"))); return; } // old links
  const [patients, index, states] = await Promise.all([
    loadJSON("data/patients.json"), loadJSON("data/index.json"), getAllStates(), loadIdentity(),
  ]);
  mountTopBar("patients");

  const scored = index.answers.filter(a => Object.keys(a.rubric_latest).length).length;
  const openFlags = index.answers.reduce((n, a) => n + flagCounts(states[a.id]).open, 0)
    + patients.reduce((n, p) => n + flagCounts(states[`patient-${p.n}`]).open, 0);
  document.getElementById("home-sub").textContent =
    `${patients.length} simulated patients · ${index.answers.length} answers across ${index.batches.length} batches · ${scored} with judge scores · ${openFlags} open flags`;

  function card(p, i) {
    const answers = index.answers.filter(a => a.profile.n === p.n);
    const questions = new Set(answers.map(a => a.question.trim().toLowerCase())).size;
    const sc = answers.filter(a => Object.keys(a.rubric_latest).length).length;
    const open = answers.reduce((n, a) => n + flagCounts(states[a.id]).open, 0) + flagCounts(states[`patient-${p.n}`]).open;
    const reviewed = answers.filter(a => isTouched(states[a.id])).length;
    return `<a class="card patient-card" style="--i:${i}" href="${patientUrl(p.n)}" data-search="${escapeHtml(`${p.name} ${p.tag} ${p.summary} ${p.conditions.join(" ")}`.toLowerCase())}">
      <div class="pc-top">
        ${monogram(p)}
        <div><div class="pc-name">${escapeHtml(p.name)}</div><div class="pc-sub">${escapeHtml(p.age_sex)}</div></div>
        <span class="pc-num">#${p.n}</span>
      </div>
      <div class="pc-summary">${escapeHtml(p.summary)}</div>
      <div class="pc-conds chip-list">
        <span class="tag accent">${escapeHtml(p.tag)}</span>
        ${p.conditions.filter(c => !p.tag.toLowerCase().includes(c.toLowerCase().split(" ")[0])).slice(0, 2).map(c => `<span class="tag">${escapeHtml(truncate(c, 34))}</span>`).join("")}
      </div>
      <div class="pc-foot">
        <span><strong>${questions}</strong> questions</span>
        <span><strong>${answers.length}</strong> answers</span>
        <span><strong>${sc}</strong> scored</span>
        ${open ? `<span class="open-flags"><strong>${open}</strong> open flags</span>` : reviewed ? `<span><strong>${reviewed}</strong> reviewed</span>` : ""}
        <span class="pc-go">Open ${icon("next")}</span>
      </div>
    </a>`;
  }

  const grid = document.getElementById("patient-grid");
  grid.innerHTML = patients.map(card).join("");
  const search = document.getElementById("patient-search");
  search.addEventListener("input", () => {
    const q = search.value.trim().toLowerCase();
    grid.querySelectorAll(".patient-card").forEach(el => { el.hidden = q && !el.dataset.search.includes(q); });
  });
})().catch(showLoadError);
