/*
 * engine.js
 * A small boolean expression language for filtering/bucketing GitHub items.
 * Properties: type, number, title, state, url, author, assignee(s), label(s),
 *   milestone, repo, createdAt, updatedAt, body, draft, merged, closed,
 *   isIssue, isPr, ageDays
 * Operators: == != =~ !~ < > <= >= contains in exists empty
 * Booleans: and or not, parentheses for grouping
 *
 * Works in browser (window.GBEngine) and node (module.exports).
 */
(function (root, factory) {
  const api = factory();
  root.GBEngine = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const DATE_FIELDS = new Set(["createdAt", "updatedAt"]);
  const NUM_FIELDS = new Set(["number", "ageDays"]);
  const ARRAY_FIELDS = new Set(["labels", "assignees"]);
  const BOOL_FIELDS = new Set(["draft", "merged", "closed", "isIssue", "isPr"]);

  const KEYWORDS = new Set(["and", "or", "not", "in", "exists", "empty", "contains"]);
  const TWO_CHAR_OPS = new Set(["==", "!=", "=~", "!~", "<=", ">="]);

  // A bareword is treated as a field reference only if it is a known field name;
  // otherwise it is interpreted as a string literal value (e.g. `pr`, `open`).
  // Stored lowercase for case-insensitive matching.
  const KNOWN_FIELDS = new Set([
    "type", "number", "title", "state", "url", "author",
    "assignee", "assignees", "label", "labels", "milestone",
    "repo", "repository", "draft", "merged", "closed",
    "isissue", "ispr", "createdat", "updatedat", "body", "agedays",
  ]);

  function alias(name) {
    switch (name) {
      case "repository": return "repo";
      case "label": return "labels";
      case "assignee": return "assignees";
      default: return name;
    }
  }

  function fieldKind(name) {
    name = alias(name);
    if (DATE_FIELDS.has(name)) return "date";
    if (NUM_FIELDS.has(name)) return "num";
    if (ARRAY_FIELDS.has(name)) return "array";
    if (BOOL_FIELDS.has(name)) return "bool";
    return "str";
  }

  function getValue(item, name) {
    name = alias(name);
    switch (name) {
      case "labels": return (item.labelNames || []);
      case "assignees": return (item.assignees || []);
      case "isIssue": return item.type === "issue";
      case "isPr": return item.type === "pr";
      case "closed": return item.state === "closed";
      default: return item[name];
    }
  }

  /* ----------------------------- tokenizer ----------------------------- */
  function tokenize(src) {
    const tokens = [];
    let i = 0;
    const n = src.length;
    while (i < n) {
      const c = src[i];
      if (/\s/.test(c)) { i++; continue; }

      if (c === "/") {
        let j = i + 1, pat = "", inClass = false;
        while (j < n) {
          const ch = src[j];
          if (ch === "\\") { pat += ch + (src[j + 1] || ""); j += 2; continue; }
          if (ch === "[") { inClass = true; }
          else if (ch === "]") { inClass = false; }
          else if (ch === "/" && !inClass) break;
          pat += ch; j++;
        }
        if (j >= n) throw new Error("Unterminated regex literal");
        j++;
        let flags = "";
        while (j < n && /[gimsuy]/.test(src[j])) { flags += src[j]; j++; }
        tokens.push({ t: "regex", value: pat, flags });
        i = j; continue;
      }

      if (c === '"' || c === "'") {
        const quote = c; let j = i + 1, s = "";
        while (j < n && src[j] !== quote) {
          if (src[j] === "\\" && j + 1 < n) {
            const nx = src[j + 1];
            s += nx === "n" ? "\n" : nx === "t" ? "\t" : nx;
            j += 2; continue;
          }
          s += src[j]; j++;
        }
        if (j >= n) throw new Error("Unterminated string literal");
        tokens.push({ t: "string", value: s });
        i = j + 1; continue;
      }

      if (/[0-9]/.test(c) || (c === "-" && /[0-9]/.test(src[i + 1] || ""))) {
        let j = i, num = "";
        if (src[j] === "-") { num += "-"; j++; }
        while (j < n && /[0-9.]/.test(src[j])) { num += src[j]; j++; }
        tokens.push({ t: "number", value: parseFloat(num) });
        i = j; continue;
      }

      const two = src.substr(i, 2);
      if (TWO_CHAR_OPS.has(two)) { tokens.push({ t: "op", value: two }); i += 2; continue; }
      if (c === "<" || c === ">") { tokens.push({ t: "op", value: c }); i++; continue; }
      if (c === "(") { tokens.push({ t: "lparen" }); i++; continue; }
      if (c === ")") { tokens.push({ t: "rparen" }); i++; continue; }
      if (c === ",") { tokens.push({ t: "comma" }); i++; continue; }

      if (/[A-Za-z_]/.test(c)) {
        let j = i, w = "";
        while (j < n && /[A-Za-z0-9_]/.test(src[j])) { w += src[j]; j++; }
        const lw = w.toLowerCase();
        if (KEYWORDS.has(lw)) tokens.push({ t: "kw", value: lw });
        else if (lw === "true") tokens.push({ t: "bool", value: true });
        else if (lw === "false") tokens.push({ t: "bool", value: false });
        else if (lw === "now" || lw === "today") tokens.push({ t: "string", value: lw });
        else tokens.push({ t: "word", value: w });
        i = j; continue;
      }

      throw new Error("Unexpected character: " + c);
    }
    tokens.push({ t: "eof" });
    return tokens;
  }

  /* ------------------------------ parser ------------------------------- */
  function parse(src) {
    const tokens = tokenize(src);
    let pos = 0;
    const peek = () => tokens[pos];
    const next = () => tokens[pos++];
    function expect(type) {
      const tk = tokens[pos];
      if (!tk || tk.t !== type) throw new Error("Expected " + type + " but got " + (tk ? tk.t : "end"));
      return tokens[pos++];
    }
    function isKw(tk, v) { return tk && tk.t === "kw" && tk.value === v; }

    function parseOr() {
      let left = parseAnd();
      while (isKw(peek(), "or")) { next(); left = { type: "or", left, right: parseAnd() }; }
      return left;
    }
    function parseAnd() {
      let left = parseNot();
      while (isKw(peek(), "and")) { next(); left = { type: "and", left, right: parseNot() }; }
      return left;
    }
    function parseNot() {
      if (isKw(peek(), "not")) { next(); return { type: "not", expr: parseNot() }; }
      return parsePrimary();
    }
    function parsePrimary() {
      const tk = peek();
      if (!tk) throw new Error("Unexpected end of expression");
      if (tk.t === "lparen") { next(); const e = parseOr(); expect("rparen"); return e; }
      return parseComparison();
    }
    function isComparisonEnd(tk) {
      if (!tk) return true;
      if (tk.t === "eof" || tk.t === "rparen" || tk.t === "comma") return true;
      if (isKw(tk, "and") || isKw(tk, "or")) return true;
      return false;
    }
    function parseComparison() {
      const left = parseOperand();
      const tk = peek();
      if (isComparisonEnd(tk)) return { type: "truth", operand: left };
      if (isKw(tk, "exists") || isKw(tk, "empty")) { next(); return { type: tk.value, operand: left }; }
      if (isKw(tk, "contains")) { next(); return { type: "contains", left, right: { kind: "value", value: parseValue() } }; }
      if (isKw(tk, "in")) {
        next(); expect("lparen");
        const list = [];
        if (peek().t !== "rparen") { list.push(parseValue()); while (peek().t === "comma") { next(); list.push(parseValue()); } }
        expect("rparen");
        return { type: "in", left, list };
      }
      if (tk.t === "op") {
        const op = tk.value; next();
        return { type: "cmp", op, left, right: { kind: "value", value: parseValue() } };
      }
      throw new Error("Unexpected token: " + tk.t);
    }
    function parseOperand() {
      const tk = peek();
      if (!tk) throw new Error("Unexpected end of expression");
      if (tk.t === "word") {
        next();
        if (KNOWN_FIELDS.has(tk.value.toLowerCase())) {
          return { kind: "field", value: tk.value };
        }
        return { kind: "value", value: { type: "string", value: tk.value } };
      }
      return { kind: "value", value: parseValue() };
    }
    function parseValue() {
      const tk = next();
      if (!tk) throw new Error("Expected a value");
      if (tk.t === "string") return { type: "string", value: tk.value };
      if (tk.t === "number") return { type: "number", value: tk.value };
      if (tk.t === "bool") return { type: "bool", value: tk.value };
      if (tk.t === "regex") return { type: "regex", value: tk.value, flags: tk.flags };
      if (tk.t === "word") return { type: "string", value: tk.value };
      throw new Error("Unexpected value token: " + tk.t);
    }

    const ast = parseOr();
    if (peek().t !== "eof") throw new Error("Unexpected trailing tokens near '" + describe(peek()) + "'");
    return ast;
  }

  function describe(tk) {
    if (!tk) return "end";
    if (tk.t === "word") return tk.value;
    if (tk.t === "string") return '"' + tk.value + '"';
    if (tk.t === "op" || tk.t === "kw") return tk.value;
    return tk.t;
  }

  /* ---------------------------- evaluator ------------------------------ */
  const strEq = (a, b) => String(a == null ? "" : a).toLowerCase() === String(b == null ? "" : b).toLowerCase();

  function toDateValue(s) {
    const v = String(s == null ? "" : s).trim().toLowerCase();
    const now = Date.now();
    if (v === "now" || v === "today") return now;
    const m = v.match(/^-?\s*(\d+)\s*([dwmy])$/);
    if (m) {
      const num = parseInt(m[1], 10);
      const ms = { d: 864e5, w: 7 * 864e5, m: 30 * 864e5, y: 365 * 864e5 }[m[2]];
      return now - num * ms;
    }
    const t = Date.parse(v.includes("t") || v.length > 4 ? v : v + "T00:00:00Z");
    return isNaN(t) ? NaN : t;
  }

  function evalTruth(operand, item) {
    if (operand.kind !== "field") return !!operand.value.value;
    const v = getValue(item, operand.value);
    if (Array.isArray(v)) return v.length > 0;
    if (typeof v === "boolean") return v;
    return v !== undefined && v !== null && v !== "";
  }

  function resolveLeft(node, item) {
    const L = node.left;
    if (L.kind === "field") {
      return { isField: true, kind: fieldKind(L.value), value: getValue(item, L.value) };
    }
    const vn = L.value;
    return { isField: false, kind: vn.type === "number" ? "num" : "str", value: vn.value };
  }
  function resolveRightValue(R, item) {
    if (R.kind === "field") return { value: getValue(item, R.value), isField: true };
    return { value: R.value.value, isField: false, node: R.value };
  }

  function evalCmp(node, item) {
    const op = node.op;
    const L = resolveLeft(node, item);
    const R = resolveRightValue(node.right, item);

    if (op === "=~" || op === "!~") {
      if (R.node && R.node.type !== "regex" && R.node.type !== "string") {
        throw new Error("Right side of =~ must be a regex or string");
      }
      const pat = R.node && R.node.type === "regex" ? R.node.value : String(R.value);
      const flags = R.node && R.node.type === "regex" ? R.node.flags : "";
      const re = new RegExp(pat, flags);
      const target = L.value;
      const match = Array.isArray(target)
        ? target.some((x) => re.test(String(x)))
        : target != null ? re.test(String(target)) : false;
      return op === "=~" ? match : !match;
    }

    if (op === "==" || op === "!=") {
      let eq;
      if ((L.kind === "num" || typeof L.value === "number") && !Array.isArray(L.value)) {
        eq = Number(L.value) === Number(R.value);
      } else if (Array.isArray(L.value)) {
        eq = L.value.some((x) => strEq(x, R.value));
      } else {
        eq = strEq(L.value, R.value);
      }
      return op === "==" ? eq : !eq;
    }

    if (op === "<" || op === ">" || op === "<=" || op === ">=") {
      let a, b;
      if (L.kind === "date") { a = Date.parse(L.value); b = toDateValue(R.value); }
      else if (L.kind === "num") { a = Number(L.value); b = Number(R.value); }
      else {
        a = L.value; b = R.value;
        if (typeof a !== "number" && typeof b !== "number") {
          const na = Number(a), nb = Number(b);
          if (!isNaN(na) && !isNaN(nb)) { a = na; b = nb; } else { a = String(a); b = String(b); }
        }
      }
      if (op === "<") return a < b;
      if (op === ">") return a > b;
      if (op === "<=") return a <= b;
      return a >= b;
    }
    throw new Error("Unknown operator: " + op);
  }

  function evalContains(node, item) {
    const L = resolveLeft(node, item);
    const R = resolveRightValue(node.right, item);
    const needle = String(R.value == null ? "" : R.value).toLowerCase();
    if (Array.isArray(L.value)) return L.value.some((x) => String(x == null ? "" : x).toLowerCase().includes(needle));
    return String(L.value == null ? "" : L.value).toLowerCase().includes(needle);
  }

  function evalIn(node, item) {
    const L = resolveLeft(node, item);
    const arr = node.list.map((v) => v.value);
    if (Array.isArray(L.value)) {
      const low = arr.map((a) => String(a).toLowerCase());
      return L.value.some((x) => low.includes(String(x).toLowerCase()));
    }
    if (typeof L.value === "number") return arr.some((a) => Number(a) === L.value);
    const low = arr.map((a) => String(a).toLowerCase());
    return low.includes(String(L.value == null ? "" : L.value).toLowerCase());
  }

  function evaluate(node, item) {
    switch (node.type) {
      case "or": return evaluate(node.left, item) || evaluate(node.right, item);
      case "and": return evaluate(node.left, item) && evaluate(node.right, item);
      case "not": return !evaluate(node.expr, item);
      case "truth": return evalTruth(node.operand, item);
      case "exists": return evalTruth(node.operand, item);
      case "empty": return !evalTruth(node.operand, item);
      case "contains": return evalContains(node, item);
      case "in": return evalIn(node, item);
      case "cmp": return evalCmp(node, item);
      default: throw new Error("Unknown node type: " + node.type);
    }
  }

  function compile(expr) {
    if (expr == null || String(expr).trim() === "") return () => true;
    const ast = parse(String(expr));
    return function (item) { return evaluate(ast, item); };
  }

  function tryCompile(expr) {
    try { return { ok: true, fn: compile(expr), error: null }; }
    catch (e) { return { ok: false, fn: null, error: e.message }; }
  }

  /* ---------- capture-group extraction (for splitter columns) ---------- */
  // Walks the AST collecting `field =~ /regex/` comparison nodes (only `and`/`or`/`not`
  // nest sub-expressions; operands are leaves). Returns them in source order.
  function collectRegexCmps(node, out) {
    if (!node) return;
    if (node.type === "cmp" && node.op === "=~") { out.push(node); return; }
    if (node.type === "and" || node.type === "or") { collectRegexCmps(node.left, out); collectRegexCmps(node.right, out); return; }
    if (node.type === "not") { collectRegexCmps(node.expr, out); return; }
  }

  function matchCmp(node, item) {
    const R = node.right;
    const rv = R.value; // { type, value, flags }
    if (!rv || rv.type !== "regex") return null;
    let re;
    try { re = new RegExp(rv.value, rv.flags || ""); } catch (e) { return null; }
    const L = node.left;
    let target;
    if (L.kind === "field") target = getValue(item, L.value);
    else target = L.value.value;
    let m = null;
    if (Array.isArray(target)) { for (const x of target) { const mm = re.exec(String(x)); if (mm) { m = mm; break; } } }
    else if (target != null) m = re.exec(String(target));
    if (!m) return null;
    const groups = m.length > 1 ? Array.prototype.slice.call(m, 1) : [];
    return { key: groups[0] != null ? groups[0] : m[0], groups, full: m[0] };
  }

  // If the predicate holds, returns the first regex capture as { key, groups, full };
  // null otherwise. Used to expand one rule into many buckets by captured value.
  function extractFromAst(ast, item) {
    if (!evaluate(ast, item)) return null;
    const out = [];
    collectRegexCmps(ast, out);
    for (const node of out) { const m = matchCmp(node, item); if (m) return m; }
    return null;
  }

  function tryExtract(expr) {
    if (expr == null || String(expr).trim() === "") return null;
    let ast;
    try { ast = parse(String(expr)); } catch (e) { return null; }
    return function (item) { try { return extractFromAst(ast, item); } catch (e) { return null; } };
  }

  // Like matchCmp but collects every capture: one per matching array element,
  // or every global-regex match for a scalar. Lets one item expand into many buckets.
  function matchCmpAll(node, item) {
    const R = node.right;
    const rv = R.value; // { type, value, flags }
    if (!rv || rv.type !== "regex") return [];
    let re;
    try { re = new RegExp(rv.value, rv.flags || ""); } catch (e) { return []; }
    const L = node.left;
    let target;
    if (L.kind === "field") target = getValue(item, L.value);
    else target = L.value.value;
    const results = [];
    const push = (m) => {
      if (!m) return;
      const groups = m.length > 1 ? Array.prototype.slice.call(m, 1) : [];
      results.push({ key: groups[0] != null ? groups[0] : m[0], groups, full: m[0] });
    };
    if (Array.isArray(target)) {
      for (const x of target) push(re.exec(String(x)));
    } else if (target != null) {
      if (rv.flags && rv.flags.indexOf("g") >= 0) {
        let m;
        while ((m = re.exec(String(target))) !== null) { push(m); if (m.index === re.lastIndex) re.lastIndex++; }
      } else push(re.exec(String(target)));
    }
    return results;
  }

  // If the predicate holds, returns all regex captures across the expression;
  // empty array otherwise. Each element is { key, groups, full }.
  function extractAllFromAst(ast, item) {
    if (!evaluate(ast, item)) return [];
    const out = [];
    collectRegexCmps(ast, out);
    const all = [];
    for (const node of out) { const ms = matchCmpAll(node, item); for (const m of ms) all.push(m); }
    return all;
  }

  function tryExtractAll(expr) {
    if (expr == null || String(expr).trim() === "") return null;
    let ast;
    try { ast = parse(String(expr)); } catch (e) { return null; }
    return function (item) { try { return extractAllFromAst(ast, item); } catch (e) { return []; } };
  }


  const FIELDS = [
    ["type", "issue | pr"],
    ["number", "e.g. 123"],
    ["title", "string"],
    ["state", "open | closed"],
    ["author", "login"],
    ["assignee / assignees", "array of logins"],
    ["label / labels", "array of label names"],
    ["milestone", "title"],
    ["repo", "owner/name"],
    ["draft", "bool (PR)"],
    ["merged", "bool (PR)"],
    ["closed", "bool"],
    ["createdAt", "ISO date"],
    ["updatedAt", "ISO date"],
    ["ageDays", "number"],
    ["body", "string"],
  ];

  const OPERATORS = [
    ["== !=", "equals / not equals (case-insensitive for text)"],
    ["=~ !~", "regex match / not match (any element for arrays)"],
    ["< > <= >=", "numeric or date comparison"],
    ["contains", "substring, or element membership for arrays"],
    ["in", "value in (a, b, c)"],
    ["exists / empty", "present / absent"],
    ["and or not", "boolean logic with ( ) grouping"],
  ];

  const EXAMPLES = [
    'labels =~ /^bug/i',
    'type == pr and draft',
    'state == open and (labels == "p0" or labels == "p1")',
    'assignees empty and ageDays > 30',
    'author == "octocat" and not milestone exists',
    'updatedAt > "-7d"',
  ];

  const SPLITTERS = [
    ['Priority: $1', 'labels =~ /^priority:(.+)$/', 'one column per priority value'],
    ['$1', 'repo =~ /^([^/]+)/', 'one column per org/owner'],
    ['Status: $1', 'type == pr and labels =~ /^status:(\\w+)$/', 'PR statuses only'],
  ];

  return { compile, tryCompile, tryExtract, tryExtractAll, tokenize, parse, evaluate, FIELDS, OPERATORS, EXAMPLES, SPLITTERS };
});
