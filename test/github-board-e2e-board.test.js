/* End-to-end test: loads the real HTML+JS in jsdom, mocks the GitHub GraphQL
 * response, and checks fetch, fixed-column bucketing, rendering, and live filter.
 * Requires jsdom: `npm install` then `node test/github-board-e2e-board.test.js`. */
const fs = require("fs");
const path = require("path");
const { JSDOM } = require("jsdom");

const ROOT = path.join(__dirname, "..");
const now = new Date().toISOString();
const SAMPLE = {
  data: {
    rateLimit: { remaining: 4900, limit: 5000, resetAt: new Date(Date.now() + 3600e3).toISOString() },
    search: {
      issueCount: 4,
      pageInfo: { hasNextPage: false, endCursor: null },
      nodes: [
        { __typename: "Issue", number: 1, title: "Login bug", state: "OPEN", url: "https://github.com/o/a/issues/1", createdAt: now, updatedAt: now, author: { login: "alice" }, labels: { nodes: [{ name: "bug", color: "#d73a4a" }] }, assignees: { nodes: [{ login: "bob" }] }, milestone: { title: "v1" }, repository: { nameWithOwner: "o/a" }, body: "x" },
        { __typename: "PullRequest", number: 2, title: "WIP fix", state: "OPEN", url: "https://github.com/o/a/pull/2", createdAt: now, updatedAt: now, author: { login: "bob" }, labels: { nodes: [{ name: "wip", color: "#fbca04" }] }, assignees: { nodes: [] }, milestone: null, repository: { nameWithOwner: "o/a" }, body: "", isDraft: true, merged: false },
        { __typename: "Issue", number: 3, title: "Old closed", state: "CLOSED", url: "https://github.com/o/b/issues/3", createdAt: now, updatedAt: now, author: { login: "carol" }, labels: { nodes: [] }, assignees: { nodes: [] }, milestone: null, repository: { nameWithOwner: "o/b" }, body: "done" },
        { __typename: "PullRequest", number: 4, title: "Merged feature", state: "MERGED", url: "https://github.com/o/a/pull/4", createdAt: now, updatedAt: now, author: { login: "dave" }, labels: { nodes: [{ name: "feature" }] }, assignees: { nodes: [{ login: "alice" }] }, milestone: { title: "v2" }, repository: { nameWithOwner: "o/a" }, body: "", isDraft: false, merged: true },
      ],
    },
  },
};

const store = {};
store["gb:token:v1"] = "pat_test";
store["gb:config:v1"] = JSON.stringify({
  query: "repo:o/a", states: "all", maxItems: 200, filter: "", sort: "updated",
  columns: [
    { name: "Draft PRs", expr: "type == pr and draft" },
    { name: "Open PRs", expr: "type == pr and not draft and state == open" },
    { name: "Open Issues", expr: "type == issue and state == open" },
    { name: "Closed", expr: "state == closed" },
  ],
  swimlanes: [], hideUnmatchedCol: false, hideUnmatchedLane: false,
});

let fetchCalls = 0;
const dom = new JSDOM(fs.readFileSync(ROOT + "/github-board.html", "utf8"), {
  url: "file://" + path.join(ROOT, "github-board.html"),
  runScripts: "dangerously", resources: "usable", pretendToBeVisual: true,
  beforeParse(window) {
    Object.defineProperty(window, "localStorage", { value: { getItem: (k) => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v); }, removeItem: (k) => { delete store[k]; } }, configurable: true });
    Object.defineProperty(window, "fetch", { value: async () => { fetchCalls++; return { ok: true, status: 200, headers: { get: () => null }, json: async () => SAMPLE }; }, configurable: true });
  },
});
const { window } = dom;
const assert = (cond, msg) => { console.log((cond ? "PASS" : "FAIL") + ": " + msg); if (!cond) process.exitCode = 1; };

let waited = 0;
const t = setInterval(() => {
  waited += 100;
  const doc = window.document;
  if (doc.querySelectorAll(".card").length === 0 && waited < 4000) return;
  clearInterval(t);
  assert(fetchCalls >= 1, "fetchBoard hit GitHub (calls=" + fetchCalls + ")");
  const heads = doc.querySelectorAll(".col-head");
  assert(heads.length === 5, "5 column headers incl. Unmatched (got " + heads.length + ")");
  const cards = doc.querySelectorAll(".card");
  assert(cards.length === 4, "4 cards rendered (got " + cards.length + ")");
  const names = Array.from(heads).map((h) => h.querySelector(".col-name").textContent.trim());
  assert(JSON.stringify(names) === JSON.stringify(["Draft PRs", "Open PRs", "Open Issues", "Closed", "Unmatched"]), "column order/names: " + JSON.stringify(names));
  const counts = Array.from(heads).map((h) => h.querySelector(".col-count").textContent.trim());
  assert(JSON.stringify(counts) === JSON.stringify(["1", "0", "1", "1", "1"]), "column counts: " + JSON.stringify(counts));
  assert(/4900\/5000/.test(doc.querySelector("#rate").textContent), "rate badge: " + doc.querySelector("#rate").textContent);
  assert(doc.querySelector("#status").classList.contains("ok"), "status ok: " + doc.querySelector("#status").textContent);
  assert(doc.querySelector("#token").value === "pat_test", "token prefilled");
  const filter = doc.querySelector("#filter");
  filter.value = "labels =~ /^bug$/";
  filter.dispatchEvent(new window.Event("input"));
  setTimeout(() => {
    const cards2 = doc.querySelectorAll(".card");
    assert(cards2.length === 1, "filter reduces to 1 card (bug label), got " + cards2.length);
    console.log("\nDONE");
    process.exit();
  }, 400);
}, 100);
