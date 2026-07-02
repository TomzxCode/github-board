/*
 * github-board.app.js
 * Front-end logic: GitHub GraphQL fetch + config UI + board rendering.
 * Depends on github-board.engine.js (window.GBEngine), loaded beforehand.
 */
(function () {
  "use strict";
  const GB = window.GBEngine;
  const $ = (s, r) => (r || document).querySelector(s);
  const $$ = (s, r) => Array.from((r || document).querySelectorAll(s));

  const LS_CONFIG = "gb:config:v1";
  const LS_TOKEN = "gb:token:v1";
  const LS_PRESETS = "gb:presets:v1";

  const DEFAULT_CONFIG = {
    query: "",
    states: "all",
    maxItems: 200,
    filter: "",
    sort: "updated",
    columns: [
      { name: "Draft PRs", expr: 'type == pr and draft' },
      { name: "Open PRs", expr: 'type == pr and not draft and state == open' },
      { name: "Open Issues", expr: 'type == issue and state == open' },
      { name: "Closed", expr: 'state == closed' },
    ],
    swimlanes: [],
    hideUnmatchedCol: false,
    hideUnmatchedLane: false,
  };

  const state = {
    config: loadConfig(),
    token: localStorage.getItem(LS_TOKEN) || "",
    items: [],
    rate: null,
    issueCount: 0,
    loading: false,
    focusHint: null,
  };

  /* ----------------------------- storage ----------------------------- */
  function loadConfig() {
    try { const raw = localStorage.getItem(LS_CONFIG); return raw ? mergeConfig(JSON.parse(raw)) : clone(DEFAULT_CONFIG); }
    catch (e) { return clone(DEFAULT_CONFIG); }
  }
  function saveConfig() { localStorage.setItem(LS_CONFIG, JSON.stringify(state.config)); }
  function clone(o) { return JSON.parse(JSON.stringify(o)); }
  function mergeConfig(c) {
    const out = clone(DEFAULT_CONFIG);
    Object.assign(out, c);
    out.columns = Array.isArray(c.columns) ? c.columns : [];
    out.swimlanes = Array.isArray(c.swimlanes) ? c.swimlanes : [];
    return out;
  }
  function getPresets() { try { return JSON.parse(localStorage.getItem(LS_PRESETS)) || {}; } catch (e) { return {}; } }
  function setPresets(p) { localStorage.setItem(LS_PRESETS, JSON.stringify(p)); }

  /* ------------------------------ utils ------------------------------ */
  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])); }
  function safeCompile(expr) { const t = GB.tryCompile(expr); return t.ok ? t.fn : null; }
  function debounce(fn, ms) { let h; return function () { clearTimeout(h); const a = arguments, self = this; h = setTimeout(() => fn.apply(self, a), ms); }; }
  function fgFor(hex) {
    const c = String(hex || "").replace("#", "");
    if (c.length < 6) return "#fff";
    const r = parseInt(c.substr(0, 2), 16), g = parseInt(c.substr(2, 2), 16), b = parseInt(c.substr(4, 2), 16);
    const lum = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
    return lum > 0.62 ? "#1a1d27" : "#fff";
  }
  function avatar(login) {
    if (!login) return "";
    return `<img class="avatar" src="https://avatars.githubusercontent.com/${encodeURIComponent(login)}?s=40&v=4" alt="" title="${esc(login)}">`;
  }
  function timeUntil(iso) {
    if (!iso) return "";
    const ms = Date.parse(iso) - Date.now();
    if (isNaN(ms)) return "";
    const mins = Math.round(ms / 60000);
    if (mins <= 0) return "now";
    if (mins < 60) return mins + "m";
    const h = Math.round(mins / 60);
    return h < 24 ? h + "h" : Math.round(h / 24) + "d";
  }

  /* --------------------------- github fetch -------------------------- */
  const GQL = `query($q:String!,$first:Int!,$after:String){
    search(first:$first,type:ISSUE,query:$q,after:$after){
      issueCount pageInfo{hasNextPage endCursor}
      nodes{ __typename
        ... on Issue{ number title state url createdAt updatedAt
          author{login} labels(first:30){nodes{name color}}
          assignees(first:10){nodes{login}} milestone{title}
          repository{nameWithOwner} body }
        ... on PullRequest{ number title state url createdAt updatedAt
          author{login} labels(first:30){nodes{name color}}
          assignees(first:10){nodes{login}} milestone{title}
          repository{nameWithOwner} body isDraft merged }
      }
    }
    rateLimit{ remaining limit resetAt }
  }`;

  async function graphql(variables) {
    const resp = await fetch("https://api.github.com/graphql", {
      method: "POST",
      headers: { Authorization: "Bearer " + state.token, "Content-Type": "application/json" },
      body: JSON.stringify({ query: GQL, variables }),
    });
    if (resp.status === 401) throw new Error("Unauthorized. Check that your token is valid.");
    if (resp.status === 403) {
      const rem = resp.headers.get("X-RateLimit-Remaining");
      if (rem === "0") throw new Error("GitHub rate limit exhausted. Try again later.");
      throw new Error("Forbidden (403). Token may lack permission.");
    }
    if (!resp.ok) throw new Error("GitHub API error: HTTP " + resp.status);
    const body = await resp.json();
    if (body.errors && body.errors.length) throw new Error("GraphQL: " + body.errors.map((e) => e.message).join("; "));
    return body.data;
  }

  function normalize(node) {
    const isPR = node.__typename === "PullRequest";
    const labels = ((node.labels && node.labels.nodes) || []).map((l) => ({ name: l.name, color: l.color || "#888888" }));
    const assignees = ((node.assignees && node.assignees.nodes) || []).map((a) => a.login);
    const repo = (node.repository && node.repository.nameWithOwner) || "";
    const updated = node.updatedAt;
    return {
      type: isPR ? "pr" : "issue",
      number: node.number,
      title: node.title || "(no title)",
      state: (node.state || "").toLowerCase(),
      url: node.url,
      author: (node.author && node.author.login) || "",
      assignees,
      labels,
      labelNames: labels.map((l) => l.name),
      milestone: (node.milestone && node.milestone.title) || "",
      repo,
      draft: !!node.isDraft,
      merged: !!node.merged,
      createdAt: node.createdAt,
      updatedAt: updated,
      ageDays: Math.round((Date.now() - Date.parse(updated)) / 864e5),
      body: node.body || "",
    };
  }

  async function fetchBoard() {
    const cfg = state.config;
    if (!state.token) { setStatus("Add a personal access token first.", "warn"); return; }
    let q = (cfg.query || "").trim();
    if (!q) { setStatus("Enter a GitHub search query (e.g. repo:owner/name).", "warn"); return; }
    if (cfg.states === "open") q += " is:open";
    else if (cfg.states === "closed") q += " is:closed";

    state.loading = true;
    setRefreshLoading(true);
    setStatus("Loading from GitHub\u2026", "info");
    try {
      const perPage = 100;
      const maxPages = 20;
      let after = null;
      const out = [];
      let rate = null, issueCount = 0;
      for (let p = 0; p < maxPages && out.length < cfg.maxItems; p++) {
        const data = await graphql({ q, first: Math.min(perPage, cfg.maxItems - out.length), after });
        if (data.rateLimit) rate = data.rateLimit;
        const search = data.search;
        issueCount = search.issueCount;
        for (const n of search.nodes) out.push(normalize(n));
        if (!search.pageInfo.hasNextPage) break;
        after = search.pageInfo.endCursor;
      }
      state.items = out.slice(0, cfg.maxItems);
      state.rate = rate;
      state.issueCount = issueCount;
      renderRate();
      setStatus(`Loaded ${state.items.length} item${state.items.length === 1 ? "" : "s"}` + (issueCount > state.items.length ? ` of ${issueCount} (raise max items)` : "") + ".", "ok");
      renderBoard();
    } catch (e) {
      setStatus(e.message, "error");
    } finally {
      state.loading = false;
      setRefreshLoading(false);
    }
  }

  /* --------------------------- board building ------------------------ */
  function sortItems(items, sort) {
    const arr = items.slice();
    switch (sort) {
      case "created": arr.sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt)); break;
      case "number-asc": arr.sort((a, b) => a.number - b.number); break;
      case "number-desc": arr.sort((a, b) => b.number - a.number); break;
      case "title": arr.sort((a, b) => a.title.localeCompare(b.title)); break;
      case "age": arr.sort((a, b) => a.ageDays - b.ageDays); break;
      default: arr.sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt));
    }
    return arr;
  }

  // A rule whose name references a capture group (e.g. "$1") splits into one
  // bucket per distinct captured value, instead of a single fixed bucket.
  function isSplitter(rule) { return /\$\d/.test(rule.name || ""); }

  function templName(template, ex) {
    return String(template || "").replace(/\$(\d)/g, (_, d) => {
      if (d === "0") return ex.full;
      const g = ex.groups[+d - 1];
      return g != null ? g : "";
    });
  }

  // Builds an ordered list of buckets for one dimension (columns or swimlanes).
  // Returns { buckets: [{name, unmatched, single}], index: Map(item -> bucketIdx) }.
  function buildDimension(rules, items, hideUnmatched, isLane) {
    if (!rules || !rules.length) rules = [{ name: isLane ? "" : "Items", expr: "" }];
    const compiled = rules.map((r) => {
      const splitter = isSplitter(r);
      return { r, splitter, pred: safeCompile(r.expr), extract: splitter ? GB.tryExtract(r.expr) : null };
    });

    const raw = [];            // { name, unmatched, single, order, sortKey, seq }
    const idToIdx = new Map(); // bucket id -> raw index
    let seq = 0;
    function add(name, id, order, sortKey, unmatched, single) {
      if (!idToIdx.has(id)) { idToIdx.set(id, raw.length); raw.push({ name, id, unmatched: !!unmatched, single: !!single, order, sortKey, seq: seq++ }); }
      return idToIdx.get(id);
    }

    // Pre-create fixed (non-splitter) buckets so empty columns/lanes still show.
    compiled.forEach((c, ri) => { if (!c.splitter && c.pred) add(c.r.name, "f" + ri, ri, "", false, false); });

    const itemIdx = new Map();
    items.forEach((it) => {
      let idx = null;
      for (let ri = 0; ri < compiled.length; ri++) {
        const c = compiled[ri];
        if (!c.pred || !c.pred(it)) continue;
        if (c.splitter) {
          const ex = c.extract ? c.extract(it) : null;
          if (!ex) continue; // matched but no capture -> fall through to next rule / unmatched
          idx = add(templName(c.r.name, ex), "d" + ri + "|" + ex.key, ri, String(ex.key), false, false);
        } else {
          idx = add(c.r.name, "f" + ri, ri, "", false, false);
        }
        break;
      }
      if (idx == null && !hideUnmatched) idx = add("Unmatched", "u", 1e9, "", true, false);
      if (idx != null) itemIdx.set(it, idx);
    });

    // Order buckets by rule position; within a splitter rule, alphabetically by
    // captured key (case-insensitive); Unmatched always last.
    const alpha = (a, b) => String(a).localeCompare(String(b), undefined, { numeric: true, sensitivity: "base" });
    const order = raw.map((_, i) => i).sort((a, b) =>
      raw[a].order - raw[b].order || alpha(raw[a].sortKey, raw[b].sortKey) || raw[a].seq - raw[b].seq);
    const buckets = order.map((i) => { const b = raw[i]; delete b.id; delete b.order; delete b.sortKey; delete b.seq; return b; });
    const remap = new Map(); order.forEach((oldIdx, newIdx) => remap.set(oldIdx, newIdx));
    const index = new Map(); itemIdx.forEach((v, k) => index.set(k, remap.get(v)));

    if (buckets.length === 0) buckets.push({ name: isLane ? "" : "Items", unmatched: false, single: !!isLane });
    return { buckets, index };
  }

  function buildGrid() {
    const cfg = state.config;
    const filterFn = safeCompile(cfg.filter);
    const items = filterFn ? state.items.filter(filterFn) : state.items;

    const colModel = buildDimension(cfg.columns, items, cfg.hideUnmatchedCol && cfg.columns.length > 0, false);
    const laneModel = buildDimension(cfg.swimlanes, items, cfg.hideUnmatchedLane && cfg.swimlanes.length > 0, true);

    const cols = colModel.buckets;
    const lanes = laneModel.buckets;
    const grid = lanes.map(() => cols.map(() => []));
    const colTotals = cols.map(() => 0);
    items.forEach((it) => {
      const ci = colModel.index.get(it);
      const li = laneModel.index.get(it);
      if (ci == null || li == null) return;
      grid[li][ci].push(it);
      colTotals[ci]++;
    });
    for (let li = 0; li < lanes.length; li++)
      for (let ci = 0; ci < cols.length; ci++)
        grid[li][ci] = sortItems(grid[li][ci] || [], cfg.sort);

    return { cols, lanes, grid, colTotals, total: items.length };
  }

  /* ---------------------------- rendering ---------------------------- */
  function cardHtml(it) {
    const labels = it.labels.map((l) =>
      `<span class="chip" style="background:${esc(l.color)};color:${fgFor(l.color)}">${esc(l.name)}</span>`).join("");
    const others = it.assignees.filter((a) => a !== it.author).map(avatar).join("");
    const badges =
      (it.draft ? `<span class="badge draft">draft</span>` : "") +
      (it.merged ? `<span class="badge merged">merged</span>` : "") +
      (it.state === "closed" && !it.merged ? `<span class="badge closed">closed</span>` : "");
    return `<a class="card ${it.type} ${it.state}" href="${esc(it.url)}" target="_blank" rel="noopener">
      <div class="card-top">
        <span class="kind">${it.type === "pr" ? "PR" : "IS"}</span>
        <span class="num">#${it.number}</span>
        ${badges}
      </div>
      <div class="card-title">${esc(it.title)}</div>
      ${labels ? `<div class="card-labels">${labels}</div>` : ""}
      <div class="card-foot">
        <span class="repo" title="${esc(it.repo)}">${esc(it.repo)}</span>
        <span class="people">${avatar(it.author)}${others}</span>
      </div>
    </a>`;
  }

  function renderBoard() {
    const board = $("#board");
    if (!state.items.length) {
      board.innerHTML = `<div class="empty">No data loaded. Enter a token and a GitHub query, then hit Refresh. ${invalidHints()}</div>`;
      return;
    }
    const { cols, lanes, grid, colTotals, total } = buildGrid();

    const head = cols.map((c, ci) =>
      `<div class="col-head${c.unmatched ? " unmatched" : ""}">
        <span class="col-name">${esc(c.name)}</span>
        <span class="col-count">${colTotals[ci]}</span>
      </div>`).join("");

    const body = lanes.map((lane, li) => {
      const laneCount = grid[li].reduce((s, cell) => s + cell.length, 0);
      const label = lane.single
        ? `<div class="lane-label empty-lane"></div>`
        : `<div class="lane-label${lane.unmatched ? " unmatched" : ""}"><span>${esc(lane.name)}</span><span class="lane-count">${laneCount}</span></div>`;
      const cells = cols.map((c, ci) => {
        const cell = grid[li][ci];
        const inner = cell.length ? cell.map(cardHtml).join("") : `<div class="cell-empty">\u00a0</div>`;
        return `<div class="cell${c.unmatched ? " unmatched" : ""}">${inner}</div>`;
      }).join("");
      return `<div class="lane-row">${label}<div class="lane-cells">${cells}</div></div>`;
    }).join("");

    board.innerHTML = `<div class="board-inner">
      <div class="board-head"><div class="lane-corner">${total} item${total === 1 ? "" : "s"}</div>${head}</div>
      ${body}
    </div>`;
  }

  function invalidHints() {
    const cfg = state.config;
    const bad = [];
    if (!safeCompile(cfg.filter)) bad.push("filter");
    cfg.columns.forEach((c, i) => { if (!safeCompile(c.expr)) bad.push('column "' + (c.name || i) + '"'); });
    cfg.swimlanes.forEach((l, i) => { if (!safeCompile(l.expr)) bad.push('swimlane "' + (l.name || i) + '"'); });
    return bad.length ? `<br><span class="warn-text">Invalid expression(s): ${esc(bad.join(", "))}. Fix them to see data.</span>` : "";
  }

  function renderRate() {
    const el = $("#rate");
    if (state.rate) {
      const r = state.rate;
      el.title = "Resets " + (r.resetAt || "");
      el.textContent = `\u26A1 ${r.remaining}/${r.limit}` + (r.resetAt ? ` \u00b7 ${timeUntil(r.resetAt)}` : "");
      el.classList.toggle("low", r.remaining < Math.max(50, r.limit * 0.1));
    } else {
      el.textContent = state.token ? "\u26A1 \u2013" : "";
    }
  }

  function setStatus(msg, kind) {
    const el = $("#status");
    el.className = "status " + (kind || "info");
    el.innerHTML = esc(msg);
  }
  function setRefreshLoading(on) { const b = $("#refresh"); b.disabled = on; b.textContent = on ? "Loading\u2026" : "Refresh"; }

  /* --------------------------- config form --------------------------- */
  function configToForm() {
    const c = state.config;
    $("#query").value = c.query;
    $("#states").value = c.states;
    $("#maxItems").value = c.maxItems;
    $("#filter").value = c.filter;
    $("#sort").value = c.sort;
    $("#hideUnmatchedCol").checked = !!c.hideUnmatchedCol;
    $("#hideUnmatchedLane").checked = !!c.hideUnmatchedLane;
    $("#token").value = state.token;
    renderRuleList("columns");
    renderRuleList("swimlanes");
    updateFilterDot();
    refreshPresetSelect();
  }
  function formToConfig() {
    const c = state.config;
    c.query = $("#query").value;
    c.states = $("#states").value;
    c.maxItems = Math.max(1, parseInt($("#maxItems").value, 10) || 200);
    c.filter = $("#filter").value;
    c.sort = $("#sort").value;
    c.hideUnmatchedCol = $("#hideUnmatchedCol").checked;
    c.hideUnmatchedLane = $("#hideUnmatchedLane").checked;
  }

  function renderRuleList(which) {
    const container = $("#" + which);
    const list = state.config[which];
    const hint = state.focusHint;
    container.innerHTML = list.map((r, i) => {
      const split = isSplitter(r);
      return `<div class="rule-row${split ? " is-split" : ""}" data-i="${i}" data-list="${which}">
        <input class="r-name" value="${esc(r.name)}" placeholder="Name (use $1 to split)" spellcheck="false">
        <input class="r-expr" value="${esc(r.expr)}" placeholder='e.g. labels =~ /^area:(.+)$/' spellcheck="false">
        <span class="r-split" title="Splitter: one bucket per captured $1 value">\u29C9</span>
        <span class="r-dot" title=""></span>
        <button class="r-up" title="Move up">\u2191</button>
        <button class="r-down" title="Move down">\u2193</button>
        <button class="r-del" title="Remove">\u2715</button>
      </div>`;
    }).join("");
    $$(".rule-row", container).forEach((row) => {
      bindRow(row);
      row.querySelector(".r-split").style.visibility = isSplitter(state.config[which][+row.dataset.i]) ? "visible" : "hidden";
    });
    $$(".r-expr", container).forEach(updateExprDot);
    if (hint && hint.list === which) {
      const row = container.querySelector(`.rule-row[data-i="${hint.i}"] .${hint.field}`);
      if (row) row.focus();
    }
    state.focusHint = null;
    toggleEmptyHint(which);
  }
  function toggleEmptyHint(which) {
    const el = $("#" + which + "Empty");
    if (el) el.style.display = state.config[which].length ? "none" : "block";
  }
  function updateExprDot(input) {
    const t = GB.tryCompile(input.value);
    const dot = input.parentElement.querySelector(".r-dot");
    dot.className = "r-dot " + (input.value.trim() === "" ? "blank" : t.ok ? "ok" : "bad");
    dot.title = t.ok ? "OK" : "Error: " + t.error;
  }
  function updateFilterDot() {
    const input = $("#filter");
    const dot = $("#filterDot");
    const t = GB.tryCompile(input.value);
    dot.className = "dot " + (input.value.trim() === "" ? "blank" : t.ok ? "ok" : "bad");
    dot.title = t.ok ? "Valid expression" : "Error: " + t.error;
    $("#filterErr").textContent = t.ok ? "" : t.error;
  }

  function bindRow(row) {
    const i = +row.dataset.i;
    const which = row.dataset.list;
    const nameI = $(".r-name", row);
    const exprI = $(".r-expr", row);
    nameI.addEventListener("input", () => {
      state.config[which][i].name = nameI.value;
      const split = isSplitter(state.config[which][i]);
      row.classList.toggle("is-split", split);
      $(".r-split", row).style.visibility = split ? "visible" : "hidden";
      schedulePreview();
    });
    exprI.addEventListener("input", () => { state.config[which][i].expr = exprI.value; updateExprDot(exprI); schedulePreview(); });
    $(".r-up", row).addEventListener("click", () => move(which, i, -1));
    $(".r-down", row).addEventListener("click", () => move(which, i, 1));
    $(".r-del", row).addEventListener("click", () => { state.config[which].splice(i, 1); state.focusHint = null; renderRuleList(which); saveConfig(); renderBoard(); });
  }
  function move(which, i, dir) {
    const list = state.config[which];
    const j = i + dir;
    if (j < 0 || j >= list.length) return;
    const tmp = list[i]; list[i] = list[j]; list[j] = tmp;
    state.focusHint = { list: which, i: j, field: "r-expr" };
    renderRuleList(which); saveConfig(); renderBoard();
  }
  function addRule(which) {
    state.config[which].push({ name: which === "columns" ? "New column" : "New lane", expr: "" });
    state.focusHint = { list: which, i: state.config[which].length - 1, field: "r-name" };
    renderRuleList(which); saveConfig();
  }

  const schedulePreview = debounce(() => { saveConfig(); renderBoard(); }, 250);

  /* ----------------------------- presets ----------------------------- */
  function refreshPresetSelect() {
    const sel = $("#presetSelect");
    const presets = getPresets();
    const names = Object.keys(presets).sort();
    const cur = sel.value;
    sel.innerHTML = `<option value="">(select preset\u2026)</option>` + names.map((n) => `<option value="${esc(n)}">${esc(n)}</option>`).join("");
    if (cur && presets[cur]) sel.value = cur;
  }
  function savePreset() {
    const name = ($("#presetName").value || "").trim();
    if (!name) { setStatus("Enter a preset name.", "warn"); return; }
    const presets = getPresets();
    presets[name] = clone(state.config);
    setPresets(presets);
    $("#presetName").value = "";
    refreshPresetSelect();
    $("#presetSelect").value = name;
    setStatus(`Saved preset "${name}".`, "ok");
  }
  function loadPreset() {
    const name = $("#presetSelect").value;
    if (!name) return;
    const presets = getPresets();
    if (!presets[name]) return;
    state.config = mergeConfig(presets[name]);
    saveConfig(); configToForm(); renderBoard();
    setStatus(`Loaded preset "${name}".`, "ok");
  }
  function deletePreset() {
    const name = $("#presetSelect").value;
    if (!name) return;
    const presets = getPresets();
    delete presets[name]; setPresets(presets);
    refreshPresetSelect();
    setStatus(`Deleted preset "${name}".`, "ok");
  }

  /* ------------------------------ token ------------------------------ */
  function saveToken() {
    state.token = ($("#token").value || "").trim();
    if (state.token) localStorage.setItem(LS_TOKEN, state.token);
    else localStorage.removeItem(LS_TOKEN);
    renderRate();
    setStatus(state.token ? "Token saved locally (never sent anywhere but GitHub)." : "Token cleared.", "ok");
  }

  /* ------------------------- shareable url --------------------------- */
  // The full config (minus the token, which never lives in state.config) is
  // serialized to URL-safe base64 JSON and carried in the hash so the link
  // works from any static host or file:// without a backend. The token is
  // deliberately excluded; recipients use their own.
  const SHARE_KEY = "c";

  function b64UrlEncodeUtf8(str) {
    const b64 = btoa(encodeURIComponent(str).replace(/%([0-9A-F]{2})/g, (_, p) => String.fromCharCode(parseInt(p, 16))));
    return b64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  }
  function b64UrlDecodeUtf8(b64url) {
    let b64 = b64url.replace(/-/g, "+").replace(/_/g, "/");
    while (b64.length % 4) b64 += "=";
    const bin = atob(b64);
    const pct = Array.from(bin, (c) => "%" + ("00" + c.charCodeAt(0).toString(16)).slice(-2)).join("");
    return decodeURIComponent(pct);
  }

  function buildShareUrl() {
    const code = b64UrlEncodeUtf8(JSON.stringify(state.config));
    return location.origin + location.pathname + location.search + "#" + SHARE_KEY + "=" + code;
  }

  async function copyToClipboard(text) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      await navigator.clipboard.writeText(text);
      return;
    }
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.style.position = "fixed";
    ta.style.top = "-1000px";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.focus();
    ta.select();
    let ok = false;
    try { ok = document.execCommand("copy"); } catch (e) { ok = false; }
    document.body.removeChild(ta);
    if (!ok) throw new Error("clipboard write failed");
  }

  function shareView() {
    formToConfig();
    saveConfig();
    let url;
    try { url = buildShareUrl(); }
    catch (e) { setStatus("Could not build share link: " + e.message, "error"); return; }
    history.replaceState(null, "", url);
    copyToClipboard(url).then(
      () => setStatus("Shareable link copied to clipboard (token excluded).", "ok"),
      () => setStatus("Shareable link is in the address bar (token excluded). Copy it manually.", "ok")
    );
  }

  // Returns true if a shared config was found in the URL and applied.
  function loadSharedConfigFromUrl() {
    const m = (location.hash || "").match(new RegExp("[#&]" + SHARE_KEY + "=([^&]+)"));
    if (!m) return false;
    try {
      const parsed = JSON.parse(b64UrlDecodeUtf8(m[1]));
      state.config = mergeConfig(parsed);
      saveConfig();
      configToForm();
      return true;
    } catch (e) {
      setStatus("Could not load shared view from URL: " + e.message, "error");
      return false;
    }
  }

  /* ------------------------------ help ------------------------------- */
  function renderHelp() {
    const fields = GB.FIELDS.map(([f, d]) => `<tr><td><code>${esc(f)}</code></td><td>${esc(d)}</td></tr>`).join("");
    const ops = GB.OPERATORS.map(([o, d]) => `<tr><td><code>${esc(o)}</code></td><td>${esc(d)}</td></tr>`).join("");
    const ex = GB.EXAMPLES.map((e) => `<li><code>${esc(e)}</code></li>`).join("");
    const sp = (GB.SPLITTERS || []).map(([n, e, d]) =>
      `<li><code>${esc(n)}</code> + <code>${esc(e)}</code><br><span class="muted">${esc(d)}</span></li>`).join("");
    $("#helpBody").innerHTML = `
      <div class="help-grid">
        <div><h4>Fields</h4><table><tbody>${fields}</tbody></table></div>
        <div><h4>Operators</h4><table><tbody>${ops}</tbody></table>
             <h4>Filter examples</h4><ul class="ex">${ex}</ul></div>
      </div>
      <h4>Auto-splitting columns / swimlanes</h4>
      <p class="help-note">If a column or swimlane <strong>name</strong> contains <code>$1</code>, the rule's regex capture expands into one bucket per distinct captured value. Put the part you want as the bucket name in a capture group, then reference it with <code>$1</code> (or <code>$2</code>, <code>$0</code> for the whole match). Examples (name \u2192 expression):</p>
      <ul class="ex split-ex">${sp}</ul>
      <p class="help-note">Relative dates: <code>"7d"</code> <code>"2w"</code> <code>"3m"</code> <code>"1y"</code> (ago), <code>"now"</code>, or <code>"YYYY-MM-DD"</code>. Strings are compared case-insensitively. Arrays (labels, assignees) match if <em>any</em> element matches.</p>`;
  }

  /* ------------------------------ wiring ----------------------------- */
  function init() {
    configToForm();
    const loadedShared = loadSharedConfigFromUrl();
    renderRate();
    renderHelp();
    renderBoard();

    $("#tokenSave").addEventListener("click", saveToken);
    $("#token").addEventListener("keydown", (e) => { if (e.key === "Enter") saveToken(); });
    $("#refresh").addEventListener("click", fetchBoard);
    $("#configToggle").addEventListener("click", () => $("#config").classList.toggle("open"));
    $("#helpToggle").addEventListener("click", () => $("#help").classList.toggle("open"));
    $("#share").addEventListener("click", shareView);
    $("#addColumn").addEventListener("click", () => addRule("columns"));
    $("#addSwimlane").addEventListener("click", () => addRule("swimlanes"));

    ["query", "maxItems", "sort"].forEach((id) => $("#" + id).addEventListener("input", () => { formToConfig(); schedulePreview(); }));
    $("#states").addEventListener("change", () => { formToConfig(); schedulePreview(); });
    $("#filter").addEventListener("input", () => { formToConfig(); updateFilterDot(); schedulePreview(); });
    $("#hideUnmatchedCol").addEventListener("change", () => { formToConfig(); schedulePreview(); });
    $("#hideUnmatchedLane").addEventListener("change", () => { formToConfig(); schedulePreview(); });

    $("#presetSelect").addEventListener("change", loadPreset);
    $("#presetSave").addEventListener("click", savePreset);
    $("#presetDelete").addEventListener("click", deletePreset);

    if (loadedShared) {
      setStatus("Loaded a shared view from the link. Add your token if prompted, then Refresh.", "info");
    }
    if (state.token && state.config.query) fetchBoard();
  }

  document.addEventListener("DOMContentLoaded", init);
})();
