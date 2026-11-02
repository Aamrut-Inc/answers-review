/* Minimal markdown for answers (escaped first, so no raw HTML gets through),
   plus a word-level diff for comparing answer versions. */

function mdInline(s) {
  // s is already escaped
  return s
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/(^|[^*])\*([^*\s][^*]*)\*/g, "$1<em>$2</em>")
    .replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g, (m, text, url) => `<a href="${url}" target="_blank" rel="noopener noreferrer">${text}</a>`)
    .replace(/(^|[\s(])(https?:\/\/[^\s<)]+)/g, (m, pre, url) => `${pre}<a href="${url}" target="_blank" rel="noopener noreferrer">${url}</a>`);
}

/* Splits markdown into top-level blocks: {type: p|h|ul|ol|table|hr|pre, html}. */
function mdBlocks(md) {
  const lines = escapeHtml(md || "").replace(/\r\n?/g, "\n").split("\n");
  const blocks = [];
  let i = 0;
  const isTableRow = l => /^\s*\|.*\|\s*$/.test(l);
  const isList = l => /^\s*([-*+]|\d+[.)])\s+/.test(l);
  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim()) { i++; continue; }
    const s0 = i;
    const push = b => blocks.push(Object.assign(b, { start: s0 }));
    if (/^```/.test(line.trim())) {
      const buf = [];
      i++;
      while (i < lines.length && !/^```/.test(lines[i].trim())) buf.push(lines[i++]);
      i++;
      push({ type: "pre", html: `<pre>${buf.join("\n")}</pre>` });
      continue;
    }
    const h = line.match(/^(#{1,6})\s+(.*)$/);
    if (h) {
      push({ type: "h", html: `<h4 class="md-h md-h${h[1].length}">${mdInline(h[2])}</h4>` });
      i++;
      continue;
    }
    if (/^\s*([-*_])\s*\1\s*\1[\s\1]*$/.test(line)) { push({ type: "hr", html: "<hr>" }); i++; continue; }
    if (isTableRow(line) && i + 1 < lines.length && /^\s*\|?\s*:?-{2,}/.test(lines[i + 1])) {
      const cells = l => l.trim().replace(/^\||\|$/g, "").split("|").map(c => mdInline(c.trim()));
      const head = cells(line);
      i += 2;
      const rows = [];
      while (i < lines.length && isTableRow(lines[i])) rows.push(cells(lines[i++]));
      push({
        type: "table",
        html: `<div class="md-table-wrap"><table class="md-table"><thead><tr>${head.map(c => `<th>${c}</th>`).join("")}</tr></thead>
          <tbody>${rows.map(r => `<tr>${r.map(c => `<td>${c}</td>`).join("")}</tr>`).join("")}</tbody></table></div>`,
      });
      continue;
    }
    if (isList(line)) {
      const ordered = /^\s*\d/.test(line);
      const start = ordered ? parseInt(line.trim(), 10) : 1;
      const items = [];
      const nextNonBlank = k => { while (k < lines.length && !lines[k].trim()) k++; return k; };
      while (i < lines.length) {
        if (!lines[i].trim()) {
          // A blank line between items keeps the same list ("loose" lists).
          const k = nextNonBlank(i);
          if (k < lines.length && isList(lines[k]) && /^\s*\d/.test(lines[k]) === ordered) { i = k; continue; }
          break;
        }
        if (!(isList(lines[i]) || (/^\s{2,}\S/.test(lines[i]) && items.length))) break;
        if (isList(lines[i])) {
          const indent = lines[i].match(/^\s*/)[0].length;
          items.push({ indent, text: lines[i].replace(/^\s*([-*+]|\d+[.)])\s+/, "") });
        } else {
          items[items.length - 1].text += " " + lines[i].trim();
        }
        i++;
      }
      const tag = ordered ? "ol" : "ul";
      push({
        type: tag,
        html: `<${tag}${ordered && start > 1 ? ` start="${start}"` : ""}>${items.map(it => `<li${it.indent >= 2 ? ' class="nested"' : ""}>${mdInline(it.text)}</li>`).join("")}</${tag}>`,
      });
      continue;
    }
    const buf = [line];
    i++;
    while (i < lines.length && lines[i].trim() && !isList(lines[i]) && !/^#{1,6}\s/.test(lines[i]) && !isTableRow(lines[i]) && !/^```/.test(lines[i].trim())) {
      buf.push(lines[i++]);
    }
    push({ type: "p", html: `<p>${buf.map(mdInline).join("<br>")}</p>` });
  }
  // Each block's source lines are [start, end): up to the next block, minus trailing blank lines.
  blocks.forEach((b, k) => {
    let end = k + 1 < blocks.length ? blocks[k + 1].start : lines.length;
    while (end > b.start + 1 && !lines[end - 1].trim()) end--;
    b.end = end;
  });
  return blocks;
}

/* Replaces block k's source lines in `md` with `replacement`. */
function replaceBlock(md, k, replacement) {
  const src = (md || "").replace(/\r\n?/g, "\n");
  const b = mdBlocks(src)[k];
  if (!b) return src;
  const lines = src.split("\n");
  return [...lines.slice(0, b.start), ...replacement.replace(/\s+$/, "").split("\n"), ...lines.slice(b.end)].join("\n");
}
function blockSource(md, k) {
  const src = (md || "").replace(/\r\n?/g, "\n");
  const b = mdBlocks(src)[k];
  return b ? src.split("\n").slice(b.start, b.end).join("\n") : "";
}

function renderMarkdown(md) {
  return mdBlocks(md).map(b => b.html).join("");
}

/* ---- Word diff (LCS on whitespace-separated tokens) ---- */
function diffWords(a, b) {
  const A = (a || "").split(/(\s+)/);
  const B = (b || "").split(/(\s+)/);
  if (A.length * B.length > 6e6) return null; // too big to diff in the browser
  const n = A.length, m = B.length;
  const dp = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i][j] = A[i] === B[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }
  const out = [];
  let i = 0, j = 0;
  const push = (type, t) => {
    const last = out[out.length - 1];
    if (last && last.type === type) last.text += t; else out.push({ type, text: t });
  };
  while (i < n && j < m) {
    if (A[i] === B[j]) { push("same", A[i]); i++; j++; }
    else if (dp[i + 1][j] >= dp[i][j + 1]) push("del", A[i++]);
    else push("ins", B[j++]);
  }
  while (i < n) push("del", A[i++]);
  while (j < m) push("ins", B[j++]);
  return out;
}

function diffHtml(a, b) {
  const parts = diffWords(a, b);
  if (!parts) return `<div class="empty-note">These versions are too long to compare word by word.</div>`;
  if (parts.every(p => p.type === "same")) return `<div class="empty-note">No differences.</div>`;
  const ins = parts.filter(p => p.type === "ins").reduce((n, p) => n + p.text.trim().split(/\s+/).filter(Boolean).length, 0);
  const del = parts.filter(p => p.type === "del").reduce((n, p) => n + p.text.trim().split(/\s+/).filter(Boolean).length, 0);
  return `<div class="diff-summary"><span class="d-ins">+${ins} words</span> <span class="d-del">−${del} words</span></div>
    <div class="diff">${parts.map(p => p.type === "same" ? escapeHtml(p.text)
      : p.type === "ins" ? `<ins>${escapeHtml(p.text)}</ins>` : `<del>${escapeHtml(p.text)}</del>`).join("")}</div>`;
}
