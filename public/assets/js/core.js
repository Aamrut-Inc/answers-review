/* Shared helpers and chrome for every page: API, data loading, review state,
   icons, monograms, sparklines, modal, top bar, activity feed. */

function escapeHtml(s) {
  if (s == null) return "";
  return String(s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}
function getParam(name) {
  return new URLSearchParams(location.search).get(name);
}
/* Answers live inside their patient's space; answer.html only redirects old links. */
function answerUrl(id, n) {
  return n ? patientUrl(n, `answer=${encodeURIComponent(id)}`) : `answer.html?answer=${encodeURIComponent(id)}`;
}
function patientUrl(n, tab) {
  return `patient.html?p=${encodeURIComponent(n)}${tab ? "#" + tab : ""}`;
}
function initials(s) {
  return (s || "").split("@")[0].split(/[\s._-]+/).filter(Boolean).map(w => w[0]).join("").slice(0, 2).toUpperCase();
}
function fmtDate(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  return isNaN(d) ? iso : d.toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
}
function fmtDateTime(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  return isNaN(d) ? iso : d.toLocaleString(undefined, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
}
function truncate(s, n) {
  s = String(s || "").replace(/\s+/g, " ").trim();
  return s.length > n ? s.slice(0, n - 1) + "…" : s;
}
function plural(n, word, pl) {
  return `${n} ${n === 1 ? word : pl || word + "s"}`;
}

/* ---------- Icons (simple strokes) ---------- */
const ICONS = {
  users: '<path d="M16 19v-1.5a3.5 3.5 0 0 0-3.5-3.5h-5A3.5 3.5 0 0 0 4 17.5V19"/><circle cx="10" cy="7.5" r="3.5"/><path d="M20 19v-1.5a3.5 3.5 0 0 0-2.5-3.35M15.5 4.2a3.5 3.5 0 0 1 0 6.6"/>',
  chart: '<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>',
  user: '<circle cx="12" cy="8" r="4"/><path d="M4 20c1.5-4 4.5-6 8-6s6.5 2 8 6"/>',
  list: '<path d="M9 6h11M9 12h11M9 18h11"/><circle cx="4.5" cy="6" r="1"/><circle cx="4.5" cy="12" r="1"/><circle cx="4.5" cy="18" r="1"/>',
  activity: '<path d="M3 12h4l3-8 4 16 3-8h4"/>',
  flag: '<path d="M5 21V4M5 4h11l-2 4 2 4H5"/>',
  edit: '<path d="M4 20h4L19 9l-4-4L4 16v4z"/><path d="M13.5 6.5l4 4"/>',
  history: '<path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5M12 7v5l3 2"/>',
  bin: '<path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/>',
  back: '<path d="M15 18l-6-6 6-6"/>',
  next: '<path d="M9 18l6-6-6-6"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="M20 20l-3.5-3.5"/>',
  heart: '<path d="M12 20s-7-4.4-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.6-7 10-7 10z"/>',
  pill: '<rect x="3" y="8.5" width="18" height="7" rx="3.5" transform="rotate(-35 12 12)"/><path d="M9.5 9.5l5 5"/>',
  beaker: '<path d="M9 3h6M10 3v6L4.5 19a1.5 1.5 0 0 0 1.3 2h12.4a1.5 1.5 0 0 0 1.3-2L14 9V3"/><path d="M7 14h10"/>',
  watch: '<rect x="6" y="6" width="12" height="12" rx="3"/><path d="M9 6l1-3h4l1 3M9 18l1 3h4l1-3M12 10v2.5l1.5 1"/>',
  calendar: '<rect x="3.5" y="5" width="17" height="15" rx="2"/><path d="M3.5 10h17M8 3v4M16 3v4"/>',
  quote: '<path d="M7 7h4v4c0 3-1.5 5-4 6M14 7h4v4c0 3-1.5 5-4 6"/>',
  doc: '<path d="M6 3h8l4 4v14H6z"/><path d="M14 3v4h4M9 12h6M9 16h6"/>',
  chat: '<path d="M4 5h16v11H9l-5 4z"/>',
  tool: '<path d="M14.5 6.5a4 4 0 0 0 5 5L12 19a2.1 2.1 0 0 1-3-3z"/><path d="M14.5 6.5L17 4l3 3-2.5 2.5"/>',
  scale: '<path d="M12 4v16M5 20h14M5 8h14M8 8l-3 6a3 3 0 0 0 6 0zM16 8l-3 6a3 3 0 0 0 6 0z"/>',
  check: '<path d="M5 12.5l4.5 4.5L19 7.5"/>',
  comment: '<path d="M5 5h14v10H10l-5 4z"/><path d="M9 10h6"/>',
  close: '<path d="M6 6l12 12M18 6L6 18"/>',
  eye: '<path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>',
  brand: '<path d="M6 3h9l4 4v14H6z"/><path d="M9 13l2.2 2.2L15.5 11"/>',
};
function icon(name, cls = "") {
  return `<svg class="i ${cls}" viewBox="0 0 24 24" aria-hidden="true">${ICONS[name] || ""}</svg>`;
}

/* ---------- Patients ---------- */
const PATIENT_HUES = [0, 160, 22, 205, 95, 330, 42, 262, 128, 186];
function patientHue(n) {
  return PATIENT_HUES[n % PATIENT_HUES.length];
}
function monogram(p, size = "", transitionName = "") {
  return `<span class="mono-badge ${size}" style="--h:${patientHue(p.n)}${transitionName ? `;view-transition-name:${transitionName}` : ""}" aria-hidden="true">${escapeHtml(initials(p.name))}</span>`;
}

/* ---------- Smooth page changes ---------- */
/* Fades the page out briefly before leaving, so moving between pages never jumps. */
function smoothNavigate(url) {
  if (matchMedia("(prefers-reduced-motion: reduce)").matches) { location.href = url; return; }
  document.body.classList.add("leaving");
  setTimeout(() => { location.href = url; }, 170);
}
document.addEventListener("click", e => {
  const a = e.target.closest && e.target.closest("a[href]");
  if (!a || e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || a.target) return;
  const href = a.getAttribute("href");
  if (!href || href.startsWith("#") || href.startsWith("http") || href.startsWith("/api/") || href.startsWith("mailto:")) return;
  const url = new URL(href, location.href);
  if (url.pathname === location.pathname && url.search === location.search) return; // same page: let hash routing handle it
  e.preventDefault();
  smoothNavigate(url.href);
});
window.addEventListener("pageshow", () => document.body.classList.remove("leaving"));

/* ---------- Server API (session cookie from login.html) ---------- */
function goToLogin() {
  location.href = `/login.html?next=${encodeURIComponent(location.pathname + location.search + location.hash)}`;
}
async function apiFetch(path, options = {}) {
  let res;
  try {
    res = await fetch(path, { credentials: "same-origin", ...options, headers: { "Content-Type": "application/json", ...(options.headers || {}) } });
  } catch (e) {
    throw new Error("Couldn't reach the server — check your connection and try again.");
  }
  let data = {};
  try { data = await res.json(); } catch (e) { /* non-JSON body */ }
  if (res.status === 401) {
    goToLogin();
    throw new Error("Your sign-in expired — taking you to the sign-in page.");
  }
  if (!res.ok) {
    const err = new Error(data.error || `Request failed (HTTP ${res.status})`);
    err.data = data;
    throw err;
  }
  return data;
}

let CURRENT_USER = "";
async function loadIdentity() {
  CURRENT_USER = (await apiFetch("/api/me")).email;
  return CURRENT_USER;
}
async function loadJSON(path) {
  const res = await fetch(path, { credentials: "same-origin" });
  if (res.status === 401) { goToLogin(); throw new Error("Not signed in"); }
  if (!res.ok) throw new Error(`${path}: HTTP ${res.status}`);
  return res.json();
}

/* ---------- Review state (mirrors functions/_lib/review.js) ---------- */
function textAt(state, version) {
  for (let i = state.versions.length - 1; i >= 0; i--) {
    const v = state.versions[i];
    if (v.version > version) continue;
    if (v.original) return null;
    if (v.text != null) return v.text;
  }
  return null;
}
async function getAnswerState(id) {
  return (await apiFetch(`/api/state/${encodeURIComponent(id)}`)).state;
}
async function getAllStates() {
  return (await apiFetch("/api/state")).states;
}
/* Sends one operation; the server applies it to the latest shared state and
   returns that state, which replaces `state` in place so references stay valid. */
async function applyReviewOp(answerId, state, op) {
  let res;
  try {
    res = await apiFetch(`/api/state/${encodeURIComponent(answerId)}`, { method: "POST", body: JSON.stringify(op) });
  } catch (e) {
    if (e.data && e.data.state) replaceState(state, e.data.state); // a conflict still shows the latest
    throw e;
  }
  replaceState(state, res.state);
  return res.result || {};
}
function replaceState(target, fresh) {
  Object.keys(target).forEach(k => delete target[k]);
  Object.assign(target, fresh);
}
function flagCounts(state) {
  const flags = (state && state.flags) || [];
  const open = flags.filter(f => f.status !== "fixed").length;
  return { open, fixed: flags.length - open, total: flags.length };
}
function isTouched(state) {
  return !!state && (state.flags.length > 0 || state.versions.length > 1 || Object.keys(state.human_levels).length > 0);
}

/* ---------- Levels ---------- */
/* Judge scores are levels, not percentages: 0.67 = Level 3 of 4. */
function levelTone(level, max) {
  if (level == null) return "none";
  if (level === max) return "top";
  if (level === 1) return "low";
  return level === max - 1 && max === 4 ? "good" : "mid";
}
function levelPips(level, max) {
  let html = `<span class="pips tone-${levelTone(level, max)}" aria-label="${level == null ? "Not scored" : `Level ${level} of ${max}`}">`;
  for (let i = 1; i <= max; i++) html += `<span class="pip ${level != null && i <= level ? "on" : ""}"></span>`;
  return html + "</span>";
}
function levelText(level, max) {
  return level == null ? "—" : `${level}<span class="of">/${max}</span>`;
}
function miniLevels(rubrics, latest) {
  return `<span class="minis">${rubrics.map(r => {
    const l = latest[r.key];
    return `<span class="mini tone-${levelTone(l && l.level, r.max)}" title="${escapeHtml(r.short)}: ${l ? `Level ${l.level} of ${r.max}` : "not scored"}"></span>`;
  }).join("")}</span>`;
}
function profileText(p) {
  return p ? `${p.n} · ${p.label}` : "";
}

/* ---------- Sparkline ---------- */
/* series: [{d, v}] (v may be null). Returns an inline SVG scaled to its box. */
function sparkline(series, opts = {}) {
  const pts = series.filter(p => typeof p.v === "number");
  if (pts.length < 2) return "";
  const t = pts.map(p => new Date(p.d).getTime());
  const t0 = Math.min(...t), t1 = Math.max(...t);
  let lo = Math.min(...pts.map(p => p.v)), hi = Math.max(...pts.map(p => p.v));
  if (opts.band) { lo = Math.min(lo, opts.band.low); hi = Math.max(hi, opts.band.high); }
  if (hi === lo) { hi += 1; lo -= 1; }
  const W = 100, H = 30, pad = 2;
  const x = ms => ((ms - t0) / (t1 - t0 || 1)) * W;
  const y = v => H - pad - ((v - lo) / (hi - lo)) * (H - 2 * pad);
  const line = pts.map((p, i) => `${i ? "L" : "M"}${x(t[i]).toFixed(2)},${y(p.v).toFixed(2)}`).join("");
  const area = `${line}L${W},${H}L0,${H}Z`;
  const band = opts.band ? `<rect class="band" x="0" width="${W}" y="${y(opts.band.high).toFixed(2)}" height="${(y(opts.band.low) - y(opts.band.high)).toFixed(2)}"/>` : "";
  return `<svg class="spark" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" aria-hidden="true">${band}<path class="area" d="${area}"/><path class="line" d="${line}"/></svg>`;
}

/* ---------- Modal ---------- */
function openModal(title, bodyHtml, opts = {}) {
  let root = document.getElementById("modal-root");
  if (!root) {
    root = document.createElement("div");
    root.id = "modal-root";
    document.body.appendChild(root);
  }
  root.innerHTML = `
    <div class="modal-overlay" id="modal-overlay">
      <div class="modal ${opts.wide ? "wide" : ""}" role="dialog" aria-modal="true" aria-label="${escapeHtml(title)}">
        <div class="modal-head">
          <h3>${escapeHtml(title)}</h3>
          <button class="icon-btn" id="modal-close" aria-label="Close" type="button">${icon("close")}</button>
        </div>
        <div class="modal-body">${bodyHtml}</div>
      </div>
    </div>`;
  document.getElementById("modal-overlay").addEventListener("mousedown", e => { if (e.target.id === "modal-overlay") closeModal(); });
  document.getElementById("modal-close").addEventListener("click", closeModal);
}
function closeModal() {
  const root = document.getElementById("modal-root");
  if (root) root.innerHTML = "";
}
document.addEventListener("keydown", e => {
  if (e.key === "Escape" && document.getElementById("modal-overlay") && !document.querySelector(".ctx-menu, .sel-flag-btn")) closeModal();
});

function toast(msg) {
  let el = document.getElementById("toast");
  if (!el) {
    el = document.createElement("div");
    el.id = "toast";
    el.className = "toast";
    el.setAttribute("role", "status");
    document.body.appendChild(el);
  }
  el.textContent = msg;
  el.classList.add("show");
  clearTimeout(toast.t);
  toast.t = setTimeout(() => el.classList.remove("show"), 2600);
}

/* ---------- Top bar ---------- */
function mountTopBar(active) {
  document.getElementById("topbar").innerHTML = `
    <a class="brand" href="index.html" aria-label="Answer QA — all patients">
      <span class="brand-mark"><svg viewBox="0 0 24 24" aria-hidden="true">${ICONS.brand}</svg></span>
      <span class="brand-name">Answer QA</span>
    </a>
    <nav class="top-nav" aria-label="Main">
      <a href="index.html" class="${active === "patients" ? "active" : ""}">${icon("users")}<span>Patients</span></a>
      <a href="dashboard.html" class="${active === "dashboard" ? "active" : ""}">${icon("chart")}<span>Team dashboard</span></a>
    </nav>
    <span class="spacer"></span>
    <span class="user-id" title="Signed in as ${escapeHtml(CURRENT_USER)}">
      <span class="avatar">${escapeHtml(initials(CURRENT_USER))}</span>
      <span class="user-email">${escapeHtml(CURRENT_USER)}</span>
      <a class="sign-out" href="/api/auth/logout">Sign out</a>
    </span>`;
}

/* ---------- Activity feed (built from review state, one source of truth) ---------- */
function buildEvents(answers, states, rubrics) {
  const events = [];
  answers.forEach(a => {
    const s = states[a.id];
    if (!s) return;
    const link = `<a href="${answerUrl(a.id, a.profile.n)}">${escapeHtml(truncate(a.question, 70))}</a>`;
    s.flags.forEach(f => events.push({ date: f.opened_date, who: f.opened_by, icon: "flag", html: `flagged <em>${escapeHtml(f.title)}</em> on ${link}` }));
    s.versions.filter(v => v.version > 1).forEach(v => events.push({
      date: v.date, who: v.by, icon: v.kind === "edit" ? "edit" : v.kind === "rollback" ? "history" : "check",
      html: `${v.kind === "edit" ? "edited" : v.kind === "rollback" ? "rolled back" : "marked fixes on"} ${link} <span class="muted">→ v${v.version}</span>`,
    }));
    Object.values(s.comments).forEach(list => list.forEach(c => events.push({ date: c.date, who: c.who, icon: "comment", html: `commented on ${link}: <em>${escapeHtml(truncate(c.text, 90))}</em>` })));
    Object.entries(s.human_levels).forEach(([k, h]) => {
      const r = rubrics.find(x => x.key === k);
      events.push({ date: h.date, who: h.by, icon: "scale", html: `set <strong>${escapeHtml(r ? r.short : k)}</strong> to Level ${h.level} on ${link}` });
    });
  });
  return events.sort((x, y) => (y.date || "").localeCompare(x.date || ""));
}
function activityHtml(events, limit = 30) {
  return events.length
    ? `<ul class="activity-feed">${events.slice(0, limit).map(e => `<li>
        <span class="act-ico">${icon(e.icon)}</span>
        <span><span class="act-who">${escapeHtml((e.who || "").split("@")[0])}</span> ${e.html}</span>
        <span class="act-time">${escapeHtml(fmtDateTime(e.date))}</span></li>`).join("")}</ul>`
    : `<div class="empty-note">No review activity yet.</div>`;
}

function showLoadError(err) {
  console.error(err);
  const el = document.createElement("div");
  el.className = "load-error";
  el.innerHTML = `<h2>Couldn't load this page</h2><p>${escapeHtml(err && err.message ? err.message : String(err))}</p>
    <p><a href="index.html">Back to all patients</a></p>`;
  document.body.innerHTML = "";
  document.body.appendChild(el);
}
