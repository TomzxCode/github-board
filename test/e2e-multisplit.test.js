/* End-to-end test for multi-splitter support: an item expands into a bucket per
 * matching rule and per matching value, so it can appear in several columns.
 * Requires jsdom: `npm install` then `node test/e2e-multisplit.test.js`. */
const fs = require("fs");
const path = require("path");
const { JSDOM } = require("jsdom");

const ROOT = path.join(__dirname, "..");
const now = new Date().toISOString();
function node(n, labels, type = "Issue") {
  return { __typename: type, number: n, title: "T" + n, state: "OPEN", url: "u" + n, createdAt: now, updatedAt: now,
    author: { login: "a" }, labels: { nodes: labels }, assignees: { nodes: [] }, milestone: null, repository: { nameWithOwner: "o/r" }, body: "" };
}
const SAMPLE = {
  data: {
    rateLimit: { remaining: 5000, limit: 5000, resetAt: now },
    search: {
      issueCount: 3, pageInfo: { hasNextPage: false, endCursor: null },
      nodes: [
        // #1: two area labels -> two buckets within one splitter
        node(1, [{ name: "area:foo" }, { name: "area:bar" }]),
        // #2: matches BOTH splitter rules (area + priority)
        node(2, [{ name: "area:foo" }, { name: "p:high" }]),
        // #3: matches nothing -> Unmatched
        node(3, [{ name: "bug" }]),
      ],
    },
  },
};

const store = {};
store["gb:token:v1"] = "pat_test";
store["gb:config:v1"] = JSON.stringify({
  query: "repo:o/r", states: "all", maxItems: 200, filter: "", sort: "number-asc",
  columns: [
    { name: "$1", expr: "labels =~ /^area:(.+)$/" },
    { name: "P:$1", expr: "labels =~ /^p:(.+)$/" },
  ],
  swimlanes: [], hideUnmatchedCol: false, hideUnmatchedLane: false,
});

let fetchCalls = 0;
const dom = new JSDOM(fs.readFileSync(ROOT + "/index.html", "utf8"), {
  url: "file://" + path.join(ROOT, "index.html"),
  runScripts: "dangerously", resources: "usable", pretendToBeVisual: true,
  beforeParse(window) {
    Object.defineProperty(window, "localStorage", { value: { getItem: (k) => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v); }, removeItem: (k) => { delete store[k]; } }, configurable: true });
    Object.defineProperty(window, "fetch", { value: async () => { fetchCalls++; return { ok: true, status: 200, headers: { get: () => null }, json: async () => SAMPLE }; }, configurable: true });
  },
});
const { window } = dom;
const assert = (c, m) => { console.log((c ? "PASS" : "FAIL") + ": " + m); if (!c) process.exitCode = 1; };

let waited = 0;
const t = setInterval(() => {
  waited += 100;
  const doc = window.document;
  if (doc.querySelectorAll(".card").length === 0 && waited < 4000) return;
  clearInterval(t);
  const heads = Array.from(doc.querySelectorAll(".col-head")).map((h) => [h.querySelector(".col-name").textContent.trim(), h.querySelector(".col-count").textContent.trim()]);
  // Rule 0 buckets (bar, foo) then rule 1 buckets (P:high), then Unmatched.
  assert(JSON.stringify(heads) === JSON.stringify([["bar", "1"], ["foo", "2"], ["P:high", "1"], ["Unmatched", "1"]]), "multi-splitter columns (bar,foo,P:high,Unmatched): " + JSON.stringify(heads));
  // 3 unique items, but #1 and #2 each render in 2 columns -> 5 cards total.
  const cards = doc.querySelectorAll(".card");
  assert(cards.length === 5, "5 cards rendered for multi-assignment (got " + cards.length + ")");
  // #1 appears in bar and foo; #2 appears in foo and P:high.
  const num1 = Array.from(doc.querySelectorAll(".card .num")).filter((e) => e.textContent.trim() === "#1").length;
  const num2 = Array.from(doc.querySelectorAll(".card .num")).filter((e) => e.textContent.trim() === "#2").length;
  assert(num1 === 2, "item #1 appears in 2 columns (got " + num1 + ")");
  assert(num2 === 2, "item #2 appears in 2 columns (got " + num2 + ")");
  console.log("\ncolumns:", JSON.stringify(heads), "cards:", cards.length);
  console.log(process.exitCode ? "\nSOME FAILED" : "\nALL PASS");
  process.exit();
}, 100);
