/* End-to-end test for the shareable-URL feature.
 * - Load direction: a URL of the form ...#c=<base64url-json> is decoded on
 *   load and applied to the form + localStorage (token never required).
 * - Encode direction: clicking Share rebuilds a #c= link from state.config
 *   (history.replaceState is stubbed so we can capture the generated URL).
 * Requires jsdom: `npm install` then `node test/e2e-share.test.js`. */
const fs = require("fs");
const path = require("path");
const { JSDOM } = require("jsdom");

const ROOT = path.join(__dirname, "..");

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

const SHARED = {
  query: "repo:shared/test",
  states: "open",
  maxItems: 50,
  filter: "labels =~ /^bug$/i",
  sort: "created",
  columns: [
    { name: "Bugs", expr: "labels =~ /^bug$/i" },
    { name: "Other", expr: "" },
  ],
  swimlanes: [{ name: "$1", expr: "repo =~ /^([^/]+)/" }],
  hideUnmatchedCol: true,
  hideUnmatchedLane: false,
};
const code = b64UrlEncodeUtf8(JSON.stringify(SHARED));

const store = {};
let fetchCalls = 0;
const dom = new JSDOM(fs.readFileSync(ROOT + "/index.html", "utf8"), {
  url: "file://" + path.join(ROOT, "index.html") + "#c=" + code,
  runScripts: "dangerously", resources: "usable", pretendToBeVisual: true,
  beforeParse(window) {
    Object.defineProperty(window, "localStorage", { value: { getItem: (k) => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v); }, removeItem: (k) => { delete store[k]; } }, configurable: true });
    Object.defineProperty(window, "fetch", { value: async () => { fetchCalls++; return { ok: true, status: 200, headers: { get: () => null }, json: async () => ({ data: { rateLimit: null, search: { issueCount: 0, pageInfo: { hasNextPage: false, endCursor: null }, nodes: [] } } }) }; }, configurable: true });
  },
});
const { window } = dom;
const assert = (c, m) => { console.log((c ? "PASS" : "FAIL") + ": " + m); if (!c) process.exitCode = 1; };

let waited = 0;
const t = setInterval(() => {
  waited += 100;
  const doc = window.document;
  const ready = doc.querySelector("#share") && doc.querySelector("#query");
  if (!ready && waited < 4000) return;
  clearInterval(t);

  // --- load direction: shared URL applied to the form ---
  assert(fetchCalls === 0, "no fetch without a token (token stays out of the link)");
  assert(doc.querySelector("#query").value === "repo:shared/test", "query loaded from link: " + doc.querySelector("#query").value);
  assert(doc.querySelector("#states").value === "open", "states loaded from link");
  assert(doc.querySelector("#maxItems").value === "50", "maxItems loaded from link");
  assert(doc.querySelector("#filter").value === "labels =~ /^bug$/i", "filter loaded from link");
  assert(doc.querySelector("#sort").value === "created", "sort loaded from link");
  assert(doc.querySelector("#hideUnmatchedCol").checked === true, "hideUnmatchedCol loaded from link");
  const colRows = doc.querySelectorAll('#columns .rule-row');
  assert(colRows.length === 2, "2 column rules loaded (got " + colRows.length + ")");
  const laneRows = doc.querySelectorAll('#swimlanes .rule-row');
  assert(laneRows.length === 1 && laneRows[0].classList.contains("is-split"), "1 splitter swimlane loaded");

  const saved = store["gb:config:v1"] ? JSON.parse(store["gb:config:v1"]) : null;
  assert(saved && saved.query === "repo:shared/test" && saved.hideUnmatchedCol === true, "shared config persisted to localStorage");
  assert(/shared view/i.test(doc.querySelector("#status").textContent), "shared-view status shown: " + doc.querySelector("#status").textContent);

  // --- encode direction: Share button rebuilds a #c= link from current config ---
  let replacedUrl = null;
  window.history.replaceState = function (st, title, url) { replacedUrl = url; };
  doc.querySelector("#query").value = "repo:encode/x";
  doc.querySelector("#query").dispatchEvent(new window.Event("input"));
  doc.querySelector("#share").dispatchEvent(new window.MouseEvent("click"));

  assert(!!replacedUrl && replacedUrl.indexOf("#c=") !== -1, "Share built a #c= link");
  if (replacedUrl) {
    const enc = replacedUrl.split("#c=")[1];
    let decoded = null;
    try { decoded = JSON.parse(b64UrlDecodeUtf8(enc)); } catch (e) { decoded = null; }
    assert(!!decoded && decoded.query === "repo:encode/x", "encoded link round-trips current config");
    assert(!!decoded && !("token" in decoded) && decoded.columns.length === 2, "encoded link excludes token and keeps columns");
  }

  console.log("\n" + (process.exitCode ? "SOME FAILED" : "ALL PASS"));
  process.exit();
}, 100);
