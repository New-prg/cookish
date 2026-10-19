// Formulas: a small expression language over objects, no eval. A formula sees
// the relations of its own object by key, follows links with a dot
// (`product.kcal100`), and calls functions from a closed table. Parsing and
// evaluation have hard limits, so a shared object cannot hang the app.

export const LIMITS = Object.freeze({ chars: 400, nodes: 200, steps: 20000, listSize: 5000 });

export class Ref {
  constructor(id) { this.id = id; }
}
const isRef = (value) => value instanceof Ref;
const refsOf = (value) => (Array.isArray(value) ? value.filter(isRef) : isRef(value) ? [value] : []);

export function tokenize(src) {
  const out = [];
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    if (/\s/.test(c)) { i++; continue; }
    if (/[0-9]/.test(c)) {
      let j = i; while (j < src.length && /[0-9.]/.test(src[j])) j++;
      out.push({ t: "num", v: Number(src.slice(i, j)) }); i = j; continue;
    }
    if (c === "'" || c === '"') {
      let j = i + 1; while (j < src.length && src[j] !== c) j++;
      if (j >= src.length) throw new Error("незакрытая строка");
      out.push({ t: "str", v: src.slice(i + 1, j) }); i = j + 1; continue;
    }
    if (/[A-Za-zА-Яа-яЁё_]/.test(c)) {
      let j = i; while (j < src.length && /[A-Za-zА-Яа-яЁё_0-9]/.test(src[j])) j++;
      out.push({ t: "id", v: src.slice(i, j) }); i = j; continue;
    }
    const two = src.slice(i, i + 2);
    if (["<=", ">=", "==", "!=", "&&", "||"].includes(two)) { out.push({ t: "op", v: two }); i += 2; continue; }
    if ("+-*/<>!(),.".includes(c)) { out.push({ t: "op", v: c }); i++; continue; }
    throw new Error(`неизвестный символ «${c}»`);
  }
  return out;
}

export function parseFormula(src) {
  const text = String(src ?? "");
  if (text.length > LIMITS.chars) throw new Error(`формула длиннее ${LIMITS.chars} символов`);
  const toks = tokenize(text);
  let p = 0;
  let nodes = 0;
  const node = (value) => { if (++nodes > LIMITS.nodes) throw new Error("формула слишком сложная"); return value; };
  const peek = () => toks[p];
  const isOp = (v) => peek()?.t === "op" && peek().v === v;
  const expect = (v) => { if (!isOp(v)) throw new Error(`ожидалось «${v}»`); p++; };
  const binary = (next, ops) => () => {
    let left = next();
    while (peek()?.t === "op" && ops.includes(peek().v)) {
      const op = toks[p++].v;
      left = node({ k: "bin", op, left, right: next() });
    }
    return left;
  };
  const primary = () => {
    const tok = toks[p++];
    if (!tok) throw new Error("формула оборвалась");
    if (tok.t === "num" || tok.t === "str") return node({ k: "lit", v: tok.v });
    if (tok.t === "op" && tok.v === "(") { const e = or(); expect(")"); return e; }
    if (tok.t === "id") {
      if (tok.v === "true" || tok.v === "false") return node({ k: "lit", v: tok.v === "true" });
      if (tok.v === "null") return node({ k: "lit", v: null });
      let expr;
      if (isOp("(")) {
        p++;
        const args = [];
        if (!isOp(")")) { do { args.push(or()); } while (isOp(",") && ++p); }
        expect(")");
        expr = node({ k: "call", fn: tok.v, args });
      } else {
        expr = node({ k: "var", name: tok.v });
      }
      while (isOp(".")) {
        p++;
        const field = toks[p++];
        if (field?.t !== "id") throw new Error("после точки нужно имя связи");
        expr = node({ k: "get", obj: expr, field: field.v });
      }
      return expr;
    }
    throw new Error(`лишний «${tok.v}»`);
  };
  const unary = () => ((isOp("-") || isOp("!")) ? node({ k: "un", op: toks[p++].v, arg: unary() }) : primary());
  const mul = binary(unary, ["*", "/"]);
  const add = binary(mul, ["+", "-"]);
  const cmp = binary(add, ["<", "<=", ">", ">=", "==", "!="]);
  const and = binary(cmp, ["&&"]);
  const or = binary(and, ["||"]);
  const ast = or();
  if (p !== toks.length) throw new Error(`лишний хвост «${toks[p].v}»`);
  return ast;
}

// Names of relations and functions a formula touches, for validation and for
// showing a person what a shared formula reads.
export function formulaRefs(ast, out = { vars: new Set(), calls: new Set(), fields: new Set() }) {
  if (!ast) return out;
  if (ast.k === "var") out.vars.add(ast.name);
  if (ast.k === "call") { out.calls.add(ast.fn); ast.args.forEach((a) => formulaRefs(a, out)); }
  if (ast.k === "get") { out.fields.add(ast.field); formulaRefs(ast.obj, out); }
  if (ast.k === "bin") { formulaRefs(ast.left, out); formulaRefs(ast.right, out); }
  if (ast.k === "un") formulaRefs(ast.arg, out);
  return out;
}

const parsed = new Map();
export function compiled(src) {
  if (!parsed.has(src)) parsed.set(src, parseFormula(src));
  return parsed.get(src);
}

const FUNCTIONS = new Map();

// Domain modules add their functions here (КБЖУ of a portion, energy of a
// session). A function gets the evaluation scope first, then its arguments.
export function registerFunctions(table) {
  for (const [name, fn] of Object.entries(table)) FUNCTIONS.set(name, fn);
}
export const hasFunction = (name) => FUNCTIONS.has(name);
export const functionNames = () => [...FUNCTIONS.keys()];

const num = (v) => (v == null || v === "" ? null : Number.isFinite(Number(v)) ? Number(v) : null);
const valuesOf = (scope, list, rel) => {
  const items = Array.isArray(list) ? list : list == null ? [] : [list];
  if (items.length > LIMITS.listSize) throw new Error("слишком длинный список");
  return items.map((item) => (rel ? scope.field(item, rel) : item));
};
const numbers = (values) => values.map(num).filter((v) => v != null);
const orderKey = (scope, item) => {
  const obj = isRef(item) ? scope.object(item.id) : null;
  return String(obj?.props?.at || obj?.props?.date || obj?.createdAt || "");
};

registerFunctions({
  if: (_s, cond, a, b) => (cond ? a : b ?? null),
  coalesce: (_s, ...args) => args.find((a) => a != null && a !== "") ?? null,
  round: (_s, x, step = 1) => (num(x) == null ? null : Math.round(num(x) / (num(step) || 1)) * (num(step) || 1)),
  floor: (_s, x) => (num(x) == null ? null : Math.floor(num(x))),
  ceil: (_s, x) => (num(x) == null ? null : Math.ceil(num(x))),
  abs: (_s, x) => (num(x) == null ? null : Math.abs(num(x))),
  min: (_s, ...args) => { const v = numbers(args.flat()); return v.length ? Math.min(...v) : null; },
  max: (_s, ...args) => { const v = numbers(args.flat()); return v.length ? Math.max(...v) : null; },
  sum: (s, list, rel) => numbers(valuesOf(s, list, rel)).reduce((a, b) => a + b, 0),
  avg: (s, list, rel) => { const v = numbers(valuesOf(s, list, rel)); return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null; },
  count: (s, list, rel) => valuesOf(s, list, rel).filter((v) => (rel ? Boolean(v) : v != null)).length,
  last: (s, list, rel) => {
    const items = (Array.isArray(list) ? list : []).slice().sort((a, b) => orderKey(s, a).localeCompare(orderKey(s, b)));
    const item = items.at(-1);
    return item == null ? null : rel ? s.field(item, rel) : item;
  },
  backlinks: (s, typeKey, relKey) => s.backlinks(String(typeKey), String(relKey)),
  days: (_s, from, to) => {
    const a = Date.parse(`${from}T00:00:00Z`), b = Date.parse(`${to}T00:00:00Z`);
    return Number.isFinite(a) && Number.isFinite(b) ? Math.round((b - a) / 86400000) : null;
  },
  addDays: (_s, date, n) => {
    const t = Date.parse(`${date}T00:00:00Z`);
    return Number.isFinite(t) ? new Date(t + (num(n) || 0) * 86400000).toISOString().slice(0, 10) : null;
  },
  weekday: (_s, date) => { const t = Date.parse(`${date}T00:00:00Z`); return Number.isFinite(t) ? new Date(t).getUTCDay() : null; },
  fmt: (_s, x, unit = "") => (num(x) == null ? "" : `${Math.round(num(x)).toLocaleString("ru-RU")}${unit ? ` ${unit}` : ""}`),
});

// Evaluates `src` for one object. `scope` comes from values.js and knows how
// to read relations, follow links and find backlinks in the current state.
export function evaluateFormula(src, scope) {
  const ast = compiled(src);
  let steps = 0;
  const step = () => { if (++steps > LIMITS.steps) throw new Error("формула слишком тяжёлая"); };
  const ev = (n) => {
    step();
    switch (n.k) {
      case "lit": return n.v;
      case "var":
        if (n.name === "this") return scope.self;
        if (n.name === "today") return scope.today;
        if (n.name === "profile") return scope.profile;
        return scope.field(scope.self, n.name);
      case "get": {
        const base = ev(n.obj);
        if (Array.isArray(base)) return base.map((item) => scope.field(item, n.field));
        return base == null ? null : scope.field(base, n.field);
      }
      case "un": { const v = ev(n.arg); return n.op === "-" ? (num(v) == null ? null : -num(v)) : !v; }
      case "bin": {
        if (n.op === "&&") return ev(n.left) && ev(n.right);
        if (n.op === "||") return ev(n.left) || ev(n.right);
        const a = ev(n.left), b = ev(n.right);
        const x = isRef(a) ? a.id : a, y = isRef(b) ? b.id : b;
        switch (n.op) {
          case "+":
            if (typeof x === "string" || typeof y === "string") return `${x ?? ""}${y ?? ""}`;
            return num(x) == null || num(y) == null ? null : num(x) + num(y);
          case "-": return num(x) == null || num(y) == null ? null : num(x) - num(y);
          case "*": return num(x) == null || num(y) == null ? null : num(x) * num(y);
          case "/": return num(x) == null || !num(y) ? null : num(x) / num(y);
          case "==": return x === y || (x == null && y == null);
          case "!=": return !(x === y || (x == null && y == null));
          case "<": return x != null && y != null && x < y;
          case "<=": return x != null && y != null && x <= y;
          case ">": return x != null && y != null && x > y;
          case ">=": return x != null && y != null && x >= y;
        }
        throw new Error(`неизвестная операция ${n.op}`);
      }
      case "call": {
        const fn = FUNCTIONS.get(n.fn);
        if (!fn) throw new Error(`нет функции ${n.fn}`);
        if (n.fn === "if") return ev(n.args[0]) ? ev(n.args[1]) : n.args[2] ? ev(n.args[2]) : null;
        return fn(scope, ...n.args.map(ev));
      }
    }
    throw new Error("неизвестный узел формулы");
  };
  const out = ev(ast);
  return isRef(out) ? out.id : Array.isArray(out) ? out.map((v) => (isRef(v) ? v.id : v)) : out;
}

export { isRef, refsOf };
