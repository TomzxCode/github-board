/* Capture-group extraction tests for github-board.engine.js (no dependencies). */
const E = require("../github-board.engine.js");
const now = new Date().toISOString();
function mk(over) {
  return Object.assign({ type: "issue", number: 1, labelNames: [], labels: [], assignees: [], repo: "o/a", state: "open", draft: false, merged: false, updatedAt: now, createdAt: now, body: "" }, over);
}
let fails = 0;
function extest(expr, item, expectedKey) {
  const fn = E.tryExtract(expr);
  if (!fn) { console.log("FAIL extract (no fn):", JSON.stringify(expr)); fails++; return; }
  const r = fn(item);
  const got = r ? r.key : null;
  const ok = got === expectedKey;
  if (!ok) fails++;
  console.log((ok ? "PASS" : "FAIL"), JSON.stringify(expr), "-> key", JSON.stringify(got), "(expected", JSON.stringify(expectedKey) + ")", "groups=", r ? JSON.stringify(r.groups) : null);
}
extest("labels =~ /^priority:(.+)$/", mk({ labelNames: ["priority:high"], labels: [{ name: "priority:high" }] }), "high");
extest("labels =~ /^priority:(.+)$/", mk({ labelNames: ["bug"] }), null); // no priority label
extest("labels =~ /^area:([a-z]+)$/", mk({ labelNames: ["area:frontend", "area:backend"] }), "frontend"); // first match
extest("type == issue and labels =~ /^(bug|feature)$/", mk({ labelNames: ["bug"] }), "bug");
extest("type == pr and labels =~ /^(bug|feature)$/", mk({ labelNames: ["bug"] }), null); // predicate false
extest("repo =~ /^([^/]+)/", mk({ repo: "acme/widgets" }), "acme"); // regex char class with '/'
extest("not (labels =~ /x/)", mk({ labelNames: [] }), null); // predicate true but no capturing match
extest("labels =~ /^(p)(\\d)$/", mk({ labelNames: ["p1"] }), "p"); // group1 used as key
console.log(fails ? "\nSOME FAILED" : "\nALL PASS");
process.exit(fails ? 1 : 0);
