/* End-to-end test for regex-capture splitter columns (alphabetical ordering).
 * Requires jsdom: `npm install` then `node test/github-board-e2e-splitter.test.js`. */
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
      issueCount: 6, pageInfo: { hasNextPage: false, endCursor: null },
      nodes: [
        node(1, [{ name: "area:zeta" }]),
        node(2, [{ name: "area:alpha" }]),
        node(3, [{ name: "area:frontend" }, { name: "bug" }]),
        node(4, [{ name: "area:p10" }]),
        node(5, [{ name: "area:p2" }]),
        node(6, [{ name: "bug" }]),
      ],
    },
  },
};

const store = {};
store["gb:token:v1"] = "pat_test";
store["gb:config:v1"] = JSON.stringify({
  query: "repo:o/r", states: "all", maxItems: 200, filter: "", sort: "number-asc",
  columns: [{ name: "$1", expr: "labels =~ /^area:(.+)$/" }],
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
const assert = (c, m) => { console.log((c ? "PASS" : "FAIL") + ": " + m); if (!c) process.exitCode = 1; };

let waited = 0;
const t = setInterval(() => {
  waited += 100;
  const doc = window.document;
  if (doc.querySelectorAll(".card").length === 0 && waited < 4000) return;
  clearInterval(t);
  const heads = Array.from(doc.querySelectorAll(".col-head")).map((h) => [h.querySelector(".col-name").textContent.trim(), h.querySelector(".col-count").textContent.trim()]);
  assert(JSON.stringify(heads) === JSON.stringify([["alpha", "1"], ["frontend", "1"], ["p2", "1"], ["p10", "1"], ["zeta", "1"], ["Unmatched", "1"]]), "splitter columns alphabetical (alpha,frontend,p2,p10,zeta,Unmatched): " + JSON.stringify(heads));
  const cfg = doc.querySelector("#config"); cfg.classList.add("open");
  const splitRow = doc.querySelector('#columns .rule-row[data-i="0"]');
  assert(!!splitRow && splitRow.classList.contains("is-split"), "splitter rule row marked is-split");
  console.log("\ncolumns:", JSON.stringify(heads));
  console.log(process.exitCode ? "\nSOME FAILED" : "\nALL PASS");
  process.exit();
}, 100);
