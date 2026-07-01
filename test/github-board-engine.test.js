/* Predicate/boolean tests for github-board.engine.js (no dependencies). */
const E = require("../github-board.engine.js");
const now = Date.now();
const day = 864e5;
const age = (d) => Math.round((now - d) / day);
const u1 = now - 2 * day, u2 = now - 1 * day, u3 = now - 40 * day, u4 = now - 90 * day;
const items = [
  { type: "issue", number: 1, title: "Bug in login", state: "open", author: "alice", assignees: ["bob"], labelNames: ["bug", "p0"], labels: [{ name: "bug" }, { name: "p0" }], milestone: "v1", repo: "o/a", draft: false, merged: false, createdAt: new Date(now - 5 * day).toISOString(), updatedAt: new Date(u1).toISOString(), ageDays: age(u1), body: "x" },
  { type: "pr", number: 2, title: "Fix bug", state: "open", author: "bob", assignees: [], labelNames: ["wip"], labels: [{ name: "wip" }], milestone: "", repo: "o/a", draft: true, merged: false, createdAt: new Date(now - 1 * day).toISOString(), updatedAt: new Date(u2).toISOString(), ageDays: age(u2), body: "" },
  { type: "pr", number: 3, title: "Feature add", state: "closed", author: "carol", assignees: ["alice"], labelNames: ["feature"], labels: [{ name: "feature" }], milestone: "v2", repo: "o/a", draft: false, merged: true, createdAt: new Date(now - 40 * day).toISOString(), updatedAt: new Date(u3).toISOString(), ageDays: age(u3), body: "done" },
  { type: "issue", number: 4, title: "Old issue", state: "open", author: "dave", assignees: [], labelNames: [], labels: [], milestone: "", repo: "o/b", draft: false, merged: false, createdAt: new Date(now - 100 * day).toISOString(), updatedAt: new Date(u4).toISOString(), ageDays: age(u4), body: "x" },
];
let fails = 0;
function test(expr, expected) {
  const tc = E.tryCompile(expr);
  if (!tc.ok) { console.log("FAIL parse:", JSON.stringify(expr), "->", tc.error); fails++; return; }
  const got = items.filter(tc.fn).length;
  const ok = got === expected;
  if (!ok) fails++;
  console.log((ok ? "PASS" : "FAIL"), JSON.stringify(expr), "=> matched", got, "(expected", expected + ")");
}
test("labels =~ /^bug/i", 1);
test("type == pr and draft", 1);
test('state == open and (labels == "p0" or labels == "p1")', 1);
test("assignees empty and ageDays > 30", 1);
test('author == "octocat"', 0);
test("not milestone exists", 2);
test('updatedAt > "-7d"', 2);
test('updatedAt > "2d"', 1); // item1 updated exactly 2d ago is NOT strictly greater
test("merged", 1);
test("isPr", 2);
test('repo == "o/b"', 1);
test('label contains "eat"', 1);
test("state in (open)", 3);
test("number >= 3", 2);
test("", 4);
test("body empty", 1);
test("draft or merged", 2);
test('assignee == "alice"', 1);
test("labels in (p0, p1)", 1);
test("title =~ /bug/i", 2);
const bad = E.tryCompile("labels =~ ");
if (bad.ok) { console.log("FAIL: bad expr compiled"); fails++; } else console.log("PASS: bad expr rejected ->", bad.error);
console.log(fails ? "\nSOME FAILED" : "\nALL PASS");
process.exit(fails ? 1 : 0);
