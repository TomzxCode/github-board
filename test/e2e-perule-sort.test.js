/* End-to-end test for per-rule split sort direction. Two splitter rules in the
 * same dimension sort their buckets independently (one asc, one desc).
 * Requires jsdom: `npm install` then `node test/e2e-perule-sort.test.js`. */
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
      issueCount: 5, pageInfo: { hasNextPage: false, endCursor: null },
      nodes: [
        node(1, [{ name: "area:zeta" }]),
        node(2, [{ name: "area:alpha" }]),
        node(3, [{ name: "area:mid" }]),
        node(4, [{ name: "p:high" }]),
        node(5, [{ name: "p:low" }]),
      ],
    },
  },
};

const store = {};
store["gb:token:v1"] = "pat_test";
store["gb:config:v1"] = JSON.stringify({
  query: "repo:o/r", states: "all", maxItems: 200, filter: "", sort: "number-asc",
  columns: [
    { name: "$1", expr: "labels =~ /^area:(.+)$/", splitSort: "asc" },
    { name: "P:$1", expr: "labels =~ /^p:(.+)$/", splitSort: "desc" },
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
  const heads = Array.from(doc.querySelectorAll(".col-head")).map((h) => h.querySelector(".col-name").textContent.trim());
  // Rule 0 asc -> alpha, mid, zeta ; Rule 1 desc -> P:low, P:high.
  assert(JSON.stringify(heads) === JSON.stringify(["alpha", "mid", "zeta", "P:low", "P:high"]), "per-rule directions (alpha,mid,zeta,P:low,P:high): " + JSON.stringify(heads));
  console.log("\ncolumns:", JSON.stringify(heads));
  console.log(process.exitCode ? "\nSOME FAILED" : "\nALL PASS");
  process.exit();
}, 100);
