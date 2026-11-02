/* Team dashboard (dashboard.html): judge levels by batch, reviewer vs judge
   agreement, judge-run health, flags, and recent activity. */

(async function () {
  const [index, patients, states] = await Promise.all([loadJSON("data/index.json"), loadJSON("data/patients.json"), getAllStates(), loadIdentity()]);
  mountTopBar("dashboard");
  const rubrics = index.rubrics;
  const patientByN = Object.fromEntries(patients.map(p => [p.n, p]));

  const sel = document.getElementById("dash-batch");
  sel.innerHTML = `<option value="">All batches</option>` + index.batches.map(b => `<option value="${escapeHtml(b.id)}">${escapeHtml(b.id)}</option>`).join("");
  try { sel.value = localStorage.getItem("ar_dash_batch") || ""; } catch (e) { /* private mode */ }
  sel.addEventListener("change", () => { try { localStorage.setItem("ar_dash_batch", sel.value); } catch (e) { /* ignore */ } render(); });

  function avgCell(answers, r) {
    const lv = answers.map(a => a.rubric_latest[r.key]).filter(Boolean).map(l => l.level);
    if (!lv.length) return `<td class="heat empty">—</td>`;
    const avg = lv.reduce((x, y) => x + y, 0) / lv.length;
    const frac = (avg - 1) / (r.max - 1); // 0 = all Level 1, 1 = all top level
    const tone = frac >= 0.85 ? "top" : frac >= 0.6 ? "good" : frac >= 0.34 ? "mid" : "low";
    return `<td class="heat tone-${tone}" title="${plural(lv.length, "scored answer")}"><span class="mono">${avg.toFixed(1)}</span><span class="of">/${r.max}</span> <span class="n">n=${lv.length}</span></td>`;
  }
  function barRows(map, linkFor) {
    return Object.entries(map).sort((a, b) => (b[1].open + b[1].fixed) - (a[1].open + a[1].fixed)).map(([k, c]) => {
      const total = c.open + c.fixed;
      return `<div class="bar-row">
        <div class="bar-label"><span>${linkFor ? `<a href="${linkFor(k)}">${escapeHtml(c.label || k)}</a>` : escapeHtml(k)}</span><span class="n">${c.open} open · ${c.fixed} fixed</span></div>
        <div class="bar-track"><div class="bar-open" style="width:${(c.open / total) * 100}%"></div><div class="bar-fixed" style="width:${(c.fixed / total) * 100}%"></div></div>
      </div>`;
    }).join("");
  }

  function render() {
    const batch = sel.value;
    const answers = index.answers.filter(a => !batch || a.batch === batch);
    const flags = answers.flatMap(a => (states[a.id] ? states[a.id].flags : []));
    const open = flags.filter(f => f.status !== "fixed").length;
    const edited = answers.filter(a => states[a.id] && states[a.id].versions.some(v => v.kind === "edit")).length;
    const scored = answers.filter(a => Object.keys(a.rubric_latest).length).length;
    const reviewed = answers.filter(a => isTouched(states[a.id])).length;

    document.getElementById("dash-chips").innerHTML = `
      <div class="dash-chip"><div class="num">${answers.length}</div><div class="lbl">Answers</div></div>
      <div class="dash-chip"><div class="num">${scored}</div><div class="lbl">With judge scores</div></div>
      <div class="dash-chip"><div class="num">${reviewed}</div><div class="lbl">Reviewed by the team</div></div>
      <div class="dash-chip"><div class="num" style="color:var(--rust)">${open}</div><div class="lbl">Open flags</div></div>
      <div class="dash-chip"><div class="num" style="color:var(--accent)">${flags.length - open}</div><div class="lbl">Fixed flags</div></div>
      <div class="dash-chip"><div class="num">${edited}</div><div class="lbl">Answers edited</div></div>`;

    const batches = batch ? index.batches.filter(b => b.id === batch) : index.batches;
    document.getElementById("dash-levels").innerHTML = `
      <div class="table-scroll"><table class="heat-table">
        <thead><tr><th>Batch</th>${rubrics.map(r => `<th>${escapeHtml(r.short)}</th>`).join("")}</tr></thead>
        <tbody>${batches.map(b => {
          const as = index.answers.filter(a => a.batch === b.id);
          return `<tr><th class="bname">${escapeHtml(b.id)}<span class="n">${as.filter(a => Object.keys(a.rubric_latest).length).length}/${as.length} scored</span></th>
            ${rubrics.map(r => avgCell(as, r)).join("")}</tr>`;
        }).join("")}</tbody>
      </table></div>`;

    document.getElementById("dash-dist").innerHTML = rubrics.map(r => {
      const counts = Array(r.max).fill(0);
      answers.forEach(a => { const l = a.rubric_latest[r.key]; if (l) counts[l.level - 1]++; });
      const total = counts.reduce((x, y) => x + y, 0);
      return `<div class="dist-row">
        <div class="bar-label"><span>${escapeHtml(r.short)}</span><span class="n">${total ? `${total} scored` : "no scores"}</span></div>
        <div class="dist-track">${total ? counts.map((c, i) => c ? `<div class="dist-seg tone-${levelTone(i + 1, r.max)}" style="width:${(c / total) * 100}%" title="Level ${i + 1}: ${c}">${c}</div>` : "").join("") : ""}</div>
      </div>`;
    }).join("") + `<div class="dist-legend">${[1, 2, 3, 4].map(l => `<span><span class="mini tone-${levelTone(l, 4)}"></span> Level ${l}</span>`).join("")}</div>`;

    document.getElementById("dash-agree").innerHTML = rubrics.map(r => {
      const pairs = answers.map(a => [a.rubric_latest[r.key], states[a.id] && states[a.id].human_levels[r.key]]).filter(([j, h]) => j && h);
      if (!pairs.length) return `<div class="agree-row"><span>${escapeHtml(r.short)}</span><span class="muted small">no reviewer levels yet</span><span></span></div>`;
      const same = pairs.filter(([j, h]) => j.level === h.level).length;
      const bias = pairs.reduce((s, [j, h]) => s + (j.level - h.level), 0) / pairs.length;
      return `<div class="agree-row"><span>${escapeHtml(r.short)}</span>
        <span><strong>${Math.round((same / pairs.length) * 100)}%</strong> agree <span class="muted small">(${same}/${pairs.length})</span></span>
        <span class="muted small">${Math.abs(bias) < 0.05 ? "no bias" : `judge ${bias > 0 ? "higher" : "lower"} by ${Math.abs(bias).toFixed(1)} level on average`}</span></div>`;
    }).join("");

    const statusCount = { scored: 0, partial: 0, failed: 0, not_scored: 0 };
    const errors = {};
    answers.forEach(a => {
      statusCount[a.scoring.status]++;
      Object.entries(a.scoring.errors).forEach(([e, n]) => (errors[e] = (errors[e] || 0) + n));
    });
    const LABEL = { scored: "All 5 judges finished", partial: "Some judges finished", failed: "All judge runs failed", not_scored: "Never sent to the judges" };
    document.getElementById("dash-health").innerHTML = Object.entries(statusCount).map(([k, n]) => `
      <div class="bar-row"><div class="bar-label"><span>${LABEL[k]}</span><span class="n">${n}</span></div>
      <div class="type-bar-track"><div class="type-bar-fill health-${k}" style="width:${answers.length ? (n / answers.length) * 100 : 0}%"></div></div></div>`).join("")
      + (Object.keys(errors).length ? `<div class="detail-h">Why judge runs failed</div><ul class="plain">${Object.entries(errors).sort((a, b) => b[1] - a[1]).map(([e, n]) => `<li><strong>${n.toLocaleString()}</strong> × ${escapeHtml(e)}</li>`).join("")}</ul>` : "");

    const cats = {};
    flags.forEach(f => { const c = f.category || "Uncategorised"; cats[c] = cats[c] || { open: 0, fixed: 0 }; cats[c][f.status === "fixed" ? "fixed" : "open"]++; });
    document.getElementById("dash-cats").innerHTML = barRows(cats) || `<div class="empty-note">No flags raised yet.</div>`;
    const profs = {};
    answers.forEach(a => {
      const s = states[a.id];
      if (!s || !s.flags.length) return;
      const k = a.profile.n;
      profs[k] = profs[k] || { open: 0, fixed: 0, label: patientByN[k] ? `${patientByN[k].name} · ${patientByN[k].tag}` : profileText(a.profile) };
      const c = flagCounts(s);
      profs[k].open += c.open; profs[k].fixed += c.fixed;
    });
    if (!batch) patients.forEach(p => {
      const c = flagCounts(states[`patient-${p.n}`]);
      if (!c.total) return;
      profs[p.n] = profs[p.n] || { open: 0, fixed: 0, label: `${p.name} · ${p.tag}` };
      profs[p.n].open += c.open; profs[p.n].fixed += c.fixed;
    });
    document.getElementById("dash-profiles").innerHTML = barRows(profs, n => patientUrl(n, "questions")) || `<div class="empty-note">No flags raised yet.</div>`;

    document.getElementById("dash-activity").innerHTML = activityHtml(buildEvents(answers, states, rubrics), 25);
  }

  render();
})().catch(showLoadError);
