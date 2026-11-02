/* Patient profile rendering, shared by the patient's Profile tab (full,
   flaggable) and the "Patient snapshot" panel on answers (compact).

   With { flaggable: true } every item carries a data-anchor (see
   flagging.js), a hover ⚑ button and a badge slot for its flag count. */

function fmtNum(v) {
  if (typeof v !== "number") return escapeHtml(v ?? "—");
  const a = Math.abs(v);
  const s = a >= 1000 ? Math.round(v).toLocaleString() : a >= 100 ? v.toFixed(0) : a >= 10 ? v.toFixed(1) : v.toFixed(2);
  return s.replace(/\.0+$/, "").replace(/(\.\d*[1-9])0+$/, "$1");
}
function slug(s) {
  return String(s || "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60);
}

function renderProfile(p, { compact = false, flaggable = false } = {}) {
  // Anchor attributes + hover flag button, only when the profile is flaggable.
  const A = (key, label) => flaggable ? `data-anchor="profile:${escapeHtml(key)}" data-anchor-label="${escapeHtml(label)}"` : "";
  const F = flaggable ? `<button class="item-flag" type="button" data-flag-here title="Flag this">${icon("flag")}</button>` : "";
  const S = flaggable ? `<span class="badge-slot"></span>` : "";

  function card(key, title, iconName, body, aside = "") {
    return `<section class="card section ${flaggable ? "flaggable-section" : ""}" ${A(`section:${key}`, `Profile · ${title}`)}>
      <div class="section-head"><h2>${icon(iconName)}${escapeHtml(title)}${S}</h2>${aside ? `<span class="aside">${aside}</span>` : ""}${flaggable ? `<button class="item-flag section-flag" type="button" data-flag-here title="Flag this section">${icon("flag")} Flag section</button>` : ""}</div>
      <div class="section-body">${body}</div>
    </section>`;
  }

  /* ---- Summary ---- */
  const [lede, ...rest] = p.narrative;
  const conds = p.conditions.primary.length + p.conditions.other.length;
  const meds = p.medications.reduce((n, g) => n + g.meds.length, 0);
  const summary = `${lede ? `<p class="lede flag-item" ${A("summary:0", "Summary · sentence 1")}>${escapeHtml(lede)}${S}${F}</p>` : ""}
    <div class="narr">${rest.map((s, i) => `<p class="flag-item" ${A(`summary:${i + 1}`, `Summary · sentence ${i + 2}`)}>${escapeHtml(s)}${S}${F}</p>`).join("")}</div>
    ${compact ? "" : `<div class="facts">
      <div class="fact"><div class="v">${escapeHtml(p.age_sex)}</div><div class="l">Age · sex</div></div>
      <div class="fact"><div class="v">${conds}</div><div class="l">Open conditions</div></div>
      <div class="fact"><div class="v">${meds}</div><div class="l">Medications</div></div>
      <div class="fact"><div class="v">${p.encounters.total ?? "—"}</div><div class="l">Visits on record</div></div>
      <div class="fact"><div class="v">${p.wearables.features.reduce((m, f) => Math.max(m, f.days), 0)}</div><div class="l">Wearable days</div></div>
      <div class="fact"><div class="v">${escapeHtml(fmtDate(p.as_of))}</div><div class="l">Chart data through</div></div>
    </div>`}`;

  /* ---- Conditions ---- */
  const c = p.conditions;
  const conditions = !c.primary.length && !c.other.length ? `<div class="empty-note">No open conditions on the chart.</div>` : `
    ${c.primary.length ? `<div class="label" style="margin-bottom:8px">Main conditions</div>
      <div class="cond-primary">${c.primary.map(x => `<div class="cond flag-item" ${A(`cond:${slug(x.label)}`, `Condition: ${x.label}`)}>
        <div class="cond-top"><span class="cond-name">${escapeHtml(x.label)}${S}</span>
          <span class="cond-meta">${escapeHtml(x.diagnosed || (x.since ? `since ${x.since}` : ""))}</span></div>
        ${x.pathway && !compact ? `<div class="cond-path">${escapeHtml(x.pathway)}</div>` : ""}${F}
      </div>`).join("")}</div>` : ""}
    ${c.other.length ? `<div class="label" style="margin:4px 0 8px">Also on the chart <span class="muted">· no resolution recorded</span></div>
      <div class="chip-list cond-other">${c.other.map(x => `<span class="tag" ${A(`cond:${slug(x.label)}`, `Condition: ${x.label}`)}>${escapeHtml(x.label)}${x.since ? ` <span class="yr">${x.since}</span>` : ""}${S}</span>`).join("")}</div>` : ""}
    ${c.resolved && !compact ? `<p class="section-note" style="margin:12px 0 0">${plural(c.resolved, "resolved condition")} not shown.</p>` : ""}`;

  /* ---- Medications ---- */
  const medications = !p.medications.length ? `<div class="empty-note">No medications on record.</div>` : p.medications.map(g => `<div class="med-group">
    ${p.medications.length > 1 ? `<div class="label" style="margin-bottom:6px">${escapeHtml(g.label)}</div>` : ""}
    <table class="med-table">
      <thead><tr><th>Drug</th><th>Dose</th>${compact ? "" : "<th>How often</th>"}<th>On it for</th></tr></thead>
      <tbody>${g.meds.map(m => `<tr class="flag-row" ${A(`med:${slug(m.drug)}`, `Medication: ${m.drug}`)}>
        <td>${escapeHtml(m.drug)}${m.as_needed ? ` <span class="tag amber" style="font-size:10.5px">as needed</span>` : ""}${S}</td>
        <td class="mono small" title="${escapeHtml(m.dose || "")}">${escapeHtml(truncate(m.dose || "—", 46))}</td>
        ${compact ? "" : `<td>${escapeHtml(m.frequency || "—")}</td>`}
        <td class="mono small" title="${escapeHtml(m.since ? `First prescribed ${m.since}` : "")}">${escapeHtml(m.for || "—")}${F}</td>
      </tr>`).join("")}</tbody>
    </table></div>`).join("");

  /* ---- Clinical numbers ---- */
  const tile = k => {
    const out = k.band && typeof k.latest.v === "number" && (k.latest.v < k.band.low || k.latest.v > k.band.high);
    return `<div class="num-tile flag-item ${out ? "out" : ""}" title="${escapeHtml(k.full_label || k.label)}" ${A(`num:${k.code}`, `Clinical number: ${k.label}`)}>
      <div class="nt-label"><span>${escapeHtml(k.label)}${S}</span>${k.relevant ? `<span class="rel">key</span>` : ""}</div>
      <div class="nt-val">${fmtNum(k.latest.v)}<span class="u">${escapeHtml(k.unit)}</span></div>
      ${sparkline(k.series, { band: k.band })}
      <div class="nt-foot"><span>${k.min != null ? `${fmtNum(k.min)}–${fmtNum(k.max)}` : ""}${k.band ? ` · range ${k.band.low}–${k.band.high}` : ""}</span><span>${escapeHtml(fmtDate(k.latest.d))}</span></div>${F}
    </div>`;
  };
  const numbers = !p.key_numbers.length ? `<div class="empty-note">No clinical measurements indexed for this patient.</div>` : `
    <div class="num-grid">${p.key_numbers.map(tile).join("")}</div>
    ${!compact && p.other_numbers.length ? `<details class="more"><summary>All other results (${p.other_numbers.length})</summary>
      <table class="mini-table"><tbody>${p.other_numbers.map(o => `<tr class="flag-row" title="${escapeHtml(o.full_label)}" ${A(`lab:${slug(o.label)}`, `Lab result: ${o.label}`)}>
        <td>${escapeHtml(o.label)}${S}</td><td class="v">${fmtNum(o.v)} <span class="muted">${escapeHtml(o.unit)}</span></td><td class="d">${escapeHtml(o.d)}${F}</td></tr>`).join("")}</tbody></table>
    </details>` : ""}
    ${!compact && p.findings.length ? `<details class="more"><summary>Qualitative findings (${p.findings.length})</summary>
      <table class="mini-table"><tbody>${p.findings.map(o => `<tr class="flag-row" ${A(`finding:${slug(o.label)}`, `Finding: ${o.label}`)}><td>${escapeHtml(o.label)}${S}</td><td class="v">${escapeHtml(o.v)}</td><td class="d">${escapeHtml(o.d)}${F}</td></tr>`).join("")}</tbody></table>
    </details>` : ""}`;

  /* ---- Wearables ---- */
  const feats = p.wearables.features.filter(f => f.days > 0);
  const shown = compact ? feats.filter(f => f.relevance === "high").concat(feats.filter(f => f.relevance !== "high")).slice(0, 4) : feats;
  const wearables = !feats.length ? `<div class="empty-note">No wearable data for this patient.</div>` : `
    <div class="num-grid">${shown.map(f => `<div class="num-tile flag-item" ${A(`wear:${f.key}`, `Wearable: ${f.label}`)}>
      <div class="nt-label"><span>${escapeHtml(f.label)}${S}</span>${f.relevance ? `<span class="rel ${f.relevance}" title="Relevance to this patient's condition">${escapeHtml(f.relevance)}</span>` : ""}</div>
      <div class="nt-val">${fmtNum(f.avg)}<span class="u">${escapeHtml(f.unit)} avg</span></div>
      ${sparkline(f.series)}
      <div class="nt-foot"><span>${f.sd != null ? `± ${fmtNum(f.sd)} day to day` : ""}</span><span>${f.days} days</span></div>${F}
    </div>`).join("")}</div>
    ${feats.length < p.wearables.features.length && !compact ? `<p class="section-note" style="margin:10px 0 0">Not recorded: ${p.wearables.features.filter(f => !f.days).map(f => escapeHtml(f.label)).join(", ")}.</p>` : ""}`;
  const wRange = p.wearables.from ? `${fmtDate(p.wearables.from)} – ${fmtDate(p.wearables.to)}` : "";

  if (compact) {
    return card("summary", "Summary", "user", summary)
      + card("conditions", "Conditions", "heart", conditions)
      + card("medications", "Medications", "pill", medications)
      + card("numbers", "Key numbers", "beaker", numbers)
      + card("wearables", "Wearable highlights", "watch", wearables, escapeHtml(wRange));
  }

  /* ---- Visits + grounding ---- */
  const e = p.encounters;
  const visits = !e.recent.length ? `<div class="empty-note">No visits on record.</div>`
    : `<ul class="visit-list">${e.recent.map(v => `<li class="flag-item" ${A(`visit:${v.date}`, `Visit ${v.date}`)}><span class="d">${escapeHtml(v.date)}</span><span>${escapeHtml(v.type)}${S}<br><span class="muted small">${escapeHtml(v.location)}</span></span>${F}</li>`).join("")}</ul>`;
  const grounding = p.grounding
    ? `<p class="section-note" style="margin:0">What the simulated patient was told about themselves before the conversations.</p>
       <details class="more"><summary>Read the brief</summary><div class="grounding">${escapeHtml(p.grounding)}</div></details>`
    : `<div class="empty-note">No grounding brief found.</div>`;

  return card("summary", "Summary", "user", summary)
    + `<div class="two-col section">${card("conditions", "Conditions", "heart", conditions)}${card("medications", "Medications", "pill", medications)}</div>`
    + card("numbers", "Clinical numbers", "beaker", numbers, "Latest value, trend and range over all readings")
    + card("wearables", "Wearable data", "watch", wearables, escapeHtml(wRange))
    + `<div class="two-col section">${card("visits", "Recent visits", "calendar", visits, e.total ? `${e.total} in total` : "")}
       ${card("grounding", "Grounding brief", "quote", grounding)}</div>`;
}
