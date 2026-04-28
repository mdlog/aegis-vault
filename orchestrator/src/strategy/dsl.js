// Mini-DSL parser + evaluator for strategy.rules expressions.
//
// Sandboxed expression language for declarative strategy manifests
// (see docs/MULTI_STRATEGY_RFC.md "Phase 1 Agent B"). Operators publish a
// JSON manifest containing rule expressions. The orchestrator parses each
// expression once, then evaluates the resulting AST against a runtime
// context (indicators, regime, AI view, position state, vault state).
//
// Security model — STRICT WHITELIST:
//   * No host language access. We never call eval(), Function(), or touch
//     any global. The only data we read is the `context` object the caller
//     passes, and only via explicit identifier resolution.
//   * Identifiers must appear in ROOT_IDENTS or MEMBER_NAMESPACES. Anything
//     else is rejected at PARSE time (defence in depth before eval).
//   * Function calls are limited to FUNCTION_TABLE entries.
//   * Strict equality only — no implicit coercion between strings/numbers.
//   * Member access is single-level only — `a.b.c` is rejected, blocking
//     prototype-walk attacks like `process.env.FOO` or `__proto__.x`.
//   * Arrays may only contain literals (used as RHS of `in`).
//   * Recursion depth bounded; tokenizer rejects unknown characters.
//
// Surface (kept intentionally minimal):
//   logical:     && || !
//   compare:     == != < <= > >=
//   arith:       + - * /
//   membership:  regime in ['A', 'B']
//   functions:   min(a, b, ...), max(a, b, ...), clamp(x, lo, hi), abs(x)
//   literals:    123, 1.5, true, false, 'string', "string", [a, b, c]
//   identifiers: rsi_14, ai.confidence, position.pnl_pct, etc.
//
// API (consumed by Phase 2 decisionEngine refactor):
//   import { parseDsl, evaluateAst, evaluateExpression } from './dsl.js';
//
//   const ast   = parseDsl('rsi_14 < 30 && macd_histogram > 0');
//   const value = evaluateAst(ast, context);
//   // OR convenience (caches AST internally per source string):
//   const value = evaluateExpression(source, context);
//
// Both throw ParseError / EvaluationError on misuse.

// ── Whitelisted identifiers ──
//
// Top-level (bare) identifiers map to context lookups. Add entries only
// after security review. Splitting indicators into their own set lets
// resolveIdentifier() know to look under `context.indicators.*`.

const INDICATOR_IDENTS = new Set([
  // RSI — `rsi` resolves to the strategy-configured period (e.g. RSI-7 if
  // strategy.indicators.rsi.period=7); `rsi_14` is a fixed legacy alias
  // that always returns the period-14 value regardless of strategy config.
  'rsi',
  'rsi_14',
  // MACD
  'macd_histogram',
  'macd_signal',
  'macd_line',
  // EMAs (strategy may emit additional periods via strategy.indicators.ema.periods)
  'ema_20',
  'ema_50',
  'ema_200',
  // Volatility — same period-aware split as RSI: `atr_pct` follows strategy
  // period, `atr_14_pct` is the fixed-14 legacy alias.
  'atr_pct',
  'atr_14_pct',
  // VWAP / volume
  'vwap_distance_pct',
  'price_vs_vwap_pct',
  'volume_zscore',
  // Price
  'price',
  'current_price',
  // Bollinger
  'bb_upper',
  'bb_lower',
  'bb_middle',
]);

const ROOT_IDENTS = new Set([
  ...INDICATOR_IDENTS,
  'regime',
]);

// Member namespaces: ai.*, position.*, vault.* — each has a fixed set of
// allowed members. Anything outside is rejected at parse time.
const MEMBER_NAMESPACES = {
  ai: new Set(['confidence', 'risk_score', 'ai_context_score', 'timing_score']),
  position: new Set(['pnl_pct', 'holding_seconds', 'notional_usd']),
  vault: new Set(['maxPositionBps', 'consecutive_losses', 'balance', 'nav']),
};

// Whitelisted functions. All pure, deterministic, no side effects.
const FUNCTION_TABLE = {
  min: (...args) => {
    if (args.length === 0) throw new EvaluationError('min() requires at least 1 argument');
    args.forEach((a, i) => assertNumber(a, `min() argument ${i}`));
    return Math.min(...args);
  },
  max: (...args) => {
    if (args.length === 0) throw new EvaluationError('max() requires at least 1 argument');
    args.forEach((a, i) => assertNumber(a, `max() argument ${i}`));
    return Math.max(...args);
  },
  clamp: (...args) => {
    if (args.length !== 3) {
      throw new EvaluationError(`clamp(x, lo, hi) requires exactly 3 arguments (got ${args.length})`);
    }
    const [x, lo, hi] = args;
    assertNumber(x, 'clamp() x');
    assertNumber(lo, 'clamp() lo');
    assertNumber(hi, 'clamp() hi');
    if (lo > hi) throw new EvaluationError(`clamp() requires lo <= hi (got ${lo}, ${hi})`);
    return Math.min(Math.max(x, lo), hi);
  },
  abs: (...args) => {
    if (args.length !== 1) {
      throw new EvaluationError(`abs(x) requires exactly 1 argument (got ${args.length})`);
    }
    assertNumber(args[0], 'abs() x');
    return Math.abs(args[0]);
  },
};

// Recursion depth limits — protect against pathological deeply-nested
// expressions that could blow the stack.
const MAX_PARSE_DEPTH = 64;
const MAX_EVAL_DEPTH = 128;

// Maximum source string length. Keeps tokenizer regex pathological-input
// safe (we use ^-anchored patterns on slice, but bound the whole input).
const MAX_SOURCE_LENGTH = 4096;

// ── Errors ──

export class ParseError extends Error {
  constructor(message, position) {
    super(typeof position === 'number' ? `Parse error at position ${position}: ${message}` : message);
    this.name = 'ParseError';
    if (typeof position === 'number') this.position = position;
  }
}

export class EvaluationError extends Error {
  constructor(message, node) {
    super(message);
    this.name = 'EvaluationError';
    if (node) this.node = node;
  }
}

// ── Tokenizer ──
//
// Token shapes:  { type, value, pos }
// types: NUM | STR | IDENT | KEYWORD | PUNCT | EOF
// keywords: true | false | in
// 2-char punct: && || == != <= >=
// 1-char punct: ! < > + - * / ( ) [ ] , .

const TOKEN_PATTERNS = [
  { name: 'WS', regex: /^\s+/ },
  { name: 'NUM', regex: /^\d+(?:\.\d+)?/ },
  { name: 'STR', regex: /^'((?:\\'|[^'])*)'|^"((?:\\"|[^"])*)"/ },
  { name: 'IDENT', regex: /^[a-zA-Z_][a-zA-Z0-9_]*/ },
  { name: 'PUNCT2', regex: /^(?:&&|\|\||==|!=|<=|>=)/ },
  { name: 'PUNCT1', regex: /^[!<>+\-*/(),.[\]]/ },
];

const KEYWORDS = new Set(['true', 'false', 'in']);

function tokenize(src) {
  const tokens = [];
  let pos = 0;
  while (pos < src.length) {
    let matched = false;
    for (const { name, regex } of TOKEN_PATTERNS) {
      const m = src.slice(pos).match(regex);
      if (!m) continue;
      matched = true;
      const text = m[0];
      if (name === 'WS') {
        pos += text.length;
        break;
      }
      if (name === 'NUM') {
        tokens.push({ type: 'NUM', value: parseFloat(text), pos });
      } else if (name === 'STR') {
        const inner = m[1] !== undefined ? m[1] : m[2];
        // Unescape \' and \" only — no \n / \t / \\ etc. (kept minimal).
        const unescaped = inner.replace(/\\(['"])/g, '$1');
        tokens.push({ type: 'STR', value: unescaped, pos });
      } else if (name === 'IDENT') {
        if (KEYWORDS.has(text)) {
          tokens.push({ type: 'KEYWORD', value: text, pos });
        } else {
          tokens.push({ type: 'IDENT', value: text, pos });
        }
      } else {
        // PUNCT1 or PUNCT2 — store raw.
        tokens.push({ type: 'PUNCT', value: text, pos });
      }
      pos += text.length;
      break;
    }
    if (!matched) {
      throw new ParseError(`Unexpected character '${src[pos]}'`, pos);
    }
  }
  tokens.push({ type: 'EOF', value: null, pos });
  return tokens;
}

// ── Parser (recursive descent, Pratt-style precedence) ──
//
// Grammar:
//   expr        → orExpr
//   orExpr      → andExpr ( '||' andExpr )*
//   andExpr     → notExpr ( '&&' notExpr )*
//   notExpr     → '!' notExpr | compareExpr
//   compareExpr → addExpr ( ( '==' | '!=' | '<' | '<=' | '>' | '>=' | 'in' ) addExpr )?
//   addExpr     → mulExpr ( ( '+' | '-' ) mulExpr )*
//   mulExpr     → unaryExpr ( ( '*' | '/' ) unaryExpr )*
//   unaryExpr   → '-' unaryExpr | primary
//   primary     → NUM | STR | 'true' | 'false' | array | ident | call | '(' expr ')'
//   array       → '[' ( arrayElem ( ',' arrayElem )* )? ']'
//   arrayElem   → literal (only — no identifiers, no expressions)
//   ident       → IDENT ( '.' IDENT )?
//   call        → IDENT '(' ( expr ( ',' expr )* )? ')'

class Parser {
  constructor(tokens) {
    this.tokens = tokens;
    this.pos = 0;
    this.depth = 0;
  }

  peek(offset = 0) {
    return this.tokens[this.pos + offset];
  }

  consume(type, value) {
    const tok = this.peek();
    if (tok.type !== type || (value !== undefined && tok.value !== value)) {
      throw new ParseError(
        `Expected ${type}${value !== undefined ? ` '${value}'` : ''} but got ${tok.type} '${tok.value}'`,
        tok.pos
      );
    }
    this.pos += 1;
    return tok;
  }

  match(type, value) {
    const tok = this.peek();
    if (tok.type !== type) return false;
    if (value !== undefined && tok.value !== value) return false;
    return true;
  }

  enter() {
    this.depth += 1;
    if (this.depth > MAX_PARSE_DEPTH) {
      throw new ParseError(`Expression too deeply nested (max ${MAX_PARSE_DEPTH})`, this.peek().pos);
    }
  }

  exit() {
    this.depth -= 1;
  }

  parseExpr() {
    this.enter();
    const node = this.parseOr();
    this.exit();
    return node;
  }

  parseOr() {
    let left = this.parseAnd();
    while (this.match('PUNCT', '||')) {
      this.consume('PUNCT', '||');
      const right = this.parseAnd();
      left = { type: 'BinaryOp', op: '||', left, right };
    }
    return left;
  }

  parseAnd() {
    let left = this.parseNot();
    while (this.match('PUNCT', '&&')) {
      this.consume('PUNCT', '&&');
      const right = this.parseNot();
      left = { type: 'BinaryOp', op: '&&', left, right };
    }
    return left;
  }

  parseNot() {
    if (this.match('PUNCT', '!')) {
      this.consume('PUNCT', '!');
      const operand = this.parseNot();
      return { type: 'UnaryOp', op: '!', operand };
    }
    return this.parseCompare();
  }

  parseCompare() {
    const left = this.parseAdd();
    const tok = this.peek();
    const cmpOps = new Set(['==', '!=', '<', '<=', '>', '>=']);
    if (tok.type === 'PUNCT' && cmpOps.has(tok.value)) {
      this.consume('PUNCT', tok.value);
      const right = this.parseAdd();
      return { type: 'BinaryOp', op: tok.value, left, right };
    }
    if (tok.type === 'KEYWORD' && tok.value === 'in') {
      this.consume('KEYWORD', 'in');
      const right = this.parseArrayLiteral();
      return { type: 'In', left, right };
    }
    return left;
  }

  parseAdd() {
    let left = this.parseMul();
    while (this.match('PUNCT', '+') || this.match('PUNCT', '-')) {
      const op = this.peek().value;
      this.consume('PUNCT', op);
      const right = this.parseMul();
      left = { type: 'BinaryOp', op, left, right };
    }
    return left;
  }

  parseMul() {
    let left = this.parseUnary();
    while (this.match('PUNCT', '*') || this.match('PUNCT', '/')) {
      const op = this.peek().value;
      this.consume('PUNCT', op);
      const right = this.parseUnary();
      left = { type: 'BinaryOp', op, left, right };
    }
    return left;
  }

  parseUnary() {
    if (this.match('PUNCT', '-')) {
      this.consume('PUNCT', '-');
      const operand = this.parseUnary();
      return { type: 'UnaryOp', op: '-', operand };
    }
    return this.parsePrimary();
  }

  parsePrimary() {
    this.enter();
    const tok = this.peek();
    let node;
    if (tok.type === 'NUM') {
      this.consume('NUM');
      node = { type: 'Literal', value: tok.value };
    } else if (tok.type === 'STR') {
      this.consume('STR');
      node = { type: 'Literal', value: tok.value };
    } else if (tok.type === 'KEYWORD' && (tok.value === 'true' || tok.value === 'false')) {
      this.consume('KEYWORD');
      node = { type: 'Literal', value: tok.value === 'true' };
    } else if (tok.type === 'PUNCT' && tok.value === '(') {
      this.consume('PUNCT', '(');
      node = this.parseExpr();
      this.consume('PUNCT', ')');
    } else if (tok.type === 'PUNCT' && tok.value === '[') {
      node = this.parseArrayLiteral();
    } else if (tok.type === 'IDENT') {
      node = this.parseIdentOrCall();
    } else {
      throw new ParseError(`Unexpected token ${tok.type} '${tok.value}'`, tok.pos);
    }
    this.exit();
    return node;
  }

  parseIdentOrCall() {
    const identTok = this.consume('IDENT');
    // Function call?
    if (this.match('PUNCT', '(')) {
      if (!Object.prototype.hasOwnProperty.call(FUNCTION_TABLE, identTok.value)) {
        throw new ParseError(`Unknown function '${identTok.value}'`, identTok.pos);
      }
      this.consume('PUNCT', '(');
      const args = [];
      if (!this.match('PUNCT', ')')) {
        args.push(this.parseExpr());
        while (this.match('PUNCT', ',')) {
          this.consume('PUNCT', ',');
          args.push(this.parseExpr());
        }
      }
      this.consume('PUNCT', ')');
      return { type: 'Call', name: identTok.value, args };
    }
    // Member access?  (single level only — `a.b.c` is rejected)
    if (this.match('PUNCT', '.')) {
      this.consume('PUNCT', '.');
      const memberTok = this.consume('IDENT');
      const ns = identTok.value;
      if (!Object.prototype.hasOwnProperty.call(MEMBER_NAMESPACES, ns)) {
        throw new ParseError(`Unknown namespace '${ns}'`, identTok.pos);
      }
      if (!MEMBER_NAMESPACES[ns].has(memberTok.value)) {
        throw new ParseError(
          `Unknown member '${ns}.${memberTok.value}' (allowed: ${[...MEMBER_NAMESPACES[ns]].join(', ')})`,
          memberTok.pos
        );
      }
      // Reject chained member access: blocks `process.env.FOO`,
      // `ai.confidence.constructor`, `__proto__.x`, etc.
      if (this.match('PUNCT', '.')) {
        throw new ParseError(`Chained member access not allowed`, this.peek().pos);
      }
      return { type: 'MemberAccess', namespace: ns, member: memberTok.value };
    }
    // Bare identifier — must be on whitelist.
    if (!ROOT_IDENTS.has(identTok.value)) {
      throw new ParseError(
        `Unknown identifier '${identTok.value}' (not in whitelist)`,
        identTok.pos
      );
    }
    return { type: 'Identifier', name: identTok.value };
  }

  parseArrayLiteral() {
    this.consume('PUNCT', '[');
    const elements = [];
    if (!this.match('PUNCT', ']')) {
      elements.push(this.parseArrayElement());
      while (this.match('PUNCT', ',')) {
        this.consume('PUNCT', ',');
        elements.push(this.parseArrayElement());
      }
    }
    this.consume('PUNCT', ']');
    return { type: 'ArrayLiteral', elements };
  }

  parseArrayElement() {
    // Arrays only contain literals — no nested arrays, no identifiers, no
    // expressions. Keeps semantics simple and predictable for `in` and
    // makes it impossible to construct dynamic arrays at runtime.
    const tok = this.peek();
    if (tok.type === 'PUNCT' && tok.value === '[') {
      throw new ParseError('Nested arrays are not allowed', tok.pos);
    }
    if (tok.type === 'NUM') {
      this.consume('NUM');
      return { type: 'Literal', value: tok.value };
    }
    if (tok.type === 'STR') {
      this.consume('STR');
      return { type: 'Literal', value: tok.value };
    }
    if (tok.type === 'KEYWORD' && (tok.value === 'true' || tok.value === 'false')) {
      this.consume('KEYWORD');
      return { type: 'Literal', value: tok.value === 'true' };
    }
    if (tok.type === 'PUNCT' && tok.value === '-') {
      this.consume('PUNCT', '-');
      const numTok = this.consume('NUM');
      return { type: 'Literal', value: -numTok.value };
    }
    throw new ParseError(`Array elements must be literals (got ${tok.type} '${tok.value}')`, tok.pos);
  }
}

// ── Public parse entrypoint ──

/**
 * Parse a DSL expression string into an AST.
 * Throws ParseError on syntax errors or whitelist violations.
 *
 * @param {string} source
 * @returns {object} AST root node
 */
export function parseDsl(source) {
  if (typeof source !== 'string') {
    throw new ParseError('Expression must be a string', 0);
  }
  if (source.length > MAX_SOURCE_LENGTH) {
    throw new ParseError(`Expression too long (max ${MAX_SOURCE_LENGTH} chars, got ${source.length})`, 0);
  }
  const tokens = tokenize(source);
  const parser = new Parser(tokens);
  const ast = parser.parseExpr();
  if (parser.peek().type !== 'EOF') {
    throw new ParseError(`Unexpected trailing token '${parser.peek().value}'`, parser.peek().pos);
  }
  return ast;
}

// Spec alias. The RFC §Mini-DSL public API names the parser
// `parseExpression`. Keep both exported so internal modules (backtester
// etc.) can use the more descriptive `parseDsl` name and external/spec
// consumers can use `parseExpression`.
export const parseExpression = parseDsl;

// Legacy alias kept for transitional code paths.
export const parseExpression_legacy = parseDsl;

// ── Evaluator ──

/**
 * Evaluate a parsed AST against a runtime context.
 *
 * Context shape (all fields optional — missing identifiers throw at eval):
 *   {
 *     indicators: { rsi_14, macd_histogram, macd_signal, macd_line,
 *                   ema_20, ema_50, ema_200, atr_14_pct, vwap_distance_pct,
 *                   volume_zscore, price, current_price,
 *                   bb_upper, bb_lower, bb_middle },
 *     regime:    'TREND_UP_STRONG' | ...,
 *     ai:        { confidence, risk_score, ai_context_score, timing_score },
 *     position:  { pnl_pct, holding_seconds, notional_usd },
 *     vault:     { maxPositionBps, consecutive_losses, balance, nav },
 *   }
 *
 * @param {object} ast
 * @param {object} context
 * @returns {boolean|number|string|Array}
 */
export function evaluateAst(ast, context) {
  if (!ast || typeof ast !== 'object') {
    throw new EvaluationError('AST must be an object');
  }
  if (!context || typeof context !== 'object') {
    throw new EvaluationError('Context must be an object');
  }
  return evalNode(ast, context, 0);
}

// AST cache for evaluateExpression() convenience. Bounded — old entries
// are evicted FIFO to prevent unbounded memory growth in long-running
// orchestrator processes that build expressions dynamically.
const AST_CACHE = new Map();
const AST_CACHE_MAX = 256;

/**
 * Convenience: parse + evaluate. Caches AST by source string so repeated
 * cycles for the same vault don't re-parse on every tick.
 *
 * @param {string} source
 * @param {object} context
 * @returns {boolean|number|string|Array}
 */
export function evaluateExpression(source, context) {
  let ast = AST_CACHE.get(source);
  if (!ast) {
    ast = parseDsl(source);
    if (AST_CACHE.size >= AST_CACHE_MAX) {
      // Evict oldest insertion (FIFO via Map iteration order).
      const firstKey = AST_CACHE.keys().next().value;
      AST_CACHE.delete(firstKey);
    }
    AST_CACHE.set(source, ast);
  }
  return evaluateAst(ast, context);
}

function evalNode(node, ctx, depth) {
  if (depth > MAX_EVAL_DEPTH) {
    throw new EvaluationError(`Evaluation too deep (max ${MAX_EVAL_DEPTH})`, node);
  }
  switch (node.type) {
    case 'Literal':
      return node.value;
    case 'ArrayLiteral':
      return node.elements.map((el) => evalNode(el, ctx, depth + 1));
    case 'Identifier':
      return resolveIdentifier(node.name, ctx);
    case 'MemberAccess':
      return resolveMember(node.namespace, node.member, ctx);
    case 'UnaryOp': {
      const v = evalNode(node.operand, ctx, depth + 1);
      if (node.op === '!') {
        if (typeof v !== 'boolean') {
          throw new EvaluationError(`'!' requires boolean (got ${typeof v})`, node);
        }
        return !v;
      }
      if (node.op === '-') {
        assertNumber(v, "unary '-'");
        return -v;
      }
      throw new EvaluationError(`Unknown unary op '${node.op}'`, node);
    }
    case 'BinaryOp':
      return evalBinary(node, ctx, depth);
    case 'In': {
      const left = evalNode(node.left, ctx, depth + 1);
      const right = evalNode(node.right, ctx, depth + 1);
      if (!Array.isArray(right)) {
        throw new EvaluationError(`'in' requires array on right-hand side`, node);
      }
      // Strict equality (and matching types).
      return right.some((el) => strictEqual(left, el));
    }
    case 'Call': {
      const fn = FUNCTION_TABLE[node.name];
      if (!fn) {
        // Should be unreachable — parser blocks unknown functions — but
        // defence in depth in case AST is constructed directly.
        throw new EvaluationError(`Unknown function '${node.name}'`, node);
      }
      const args = node.args.map((a) => evalNode(a, ctx, depth + 1));
      return fn(...args);
    }
    default:
      throw new EvaluationError(`Unknown AST node type '${node.type}'`, node);
  }
}

function evalBinary(node, ctx, depth) {
  const { op } = node;
  // Short-circuit logical ops — evaluate right only if needed.
  if (op === '&&' || op === '||') {
    const left = evalNode(node.left, ctx, depth + 1);
    if (typeof left !== 'boolean') {
      throw new EvaluationError(`'${op}' requires boolean left operand (got ${typeof left})`, node);
    }
    if (op === '&&' && !left) return false;
    if (op === '||' && left) return true;
    const right = evalNode(node.right, ctx, depth + 1);
    if (typeof right !== 'boolean') {
      throw new EvaluationError(`'${op}' requires boolean right operand (got ${typeof right})`, node);
    }
    return right;
  }

  const left = evalNode(node.left, ctx, depth + 1);
  const right = evalNode(node.right, ctx, depth + 1);

  switch (op) {
    case '==':
      return strictEqual(left, right);
    case '!=':
      return !strictEqual(left, right);
    case '<':
    case '<=':
    case '>':
    case '>=': {
      assertNumber(left, `'${op}' left`);
      assertNumber(right, `'${op}' right`);
      if (op === '<') return left < right;
      if (op === '<=') return left <= right;
      if (op === '>') return left > right;
      return left >= right;
    }
    case '+':
    case '-':
    case '*':
    case '/': {
      assertNumber(left, `'${op}' left`);
      assertNumber(right, `'${op}' right`);
      if (op === '/') {
        if (right === 0) throw new EvaluationError('Division by zero', node);
        return left / right;
      }
      if (op === '+') return left + right;
      if (op === '-') return left - right;
      return left * right;
    }
    default:
      throw new EvaluationError(`Unknown binary op '${op}'`, node);
  }
}

function resolveIdentifier(name, ctx) {
  if (name === 'regime') {
    if (ctx.regime === undefined || ctx.regime === null) {
      throw new EvaluationError(`Identifier 'regime' is undefined in context`);
    }
    if (typeof ctx.regime !== 'string') {
      throw new EvaluationError(`Identifier 'regime' must be a string (got ${typeof ctx.regime})`);
    }
    return ctx.regime;
  }
  if (INDICATOR_IDENTS.has(name)) {
    // Indicators can be supplied either nested under `context.indicators.X`
    // OR flat at `context.X`. Nested takes precedence — that matches the
    // existing pattern in decisionEngine where indicators arrive bundled.
    let v;
    const indicators = ctx.indicators;
    if (indicators && typeof indicators === 'object' && Object.prototype.hasOwnProperty.call(indicators, name)) {
      v = indicators[name];
    } else if (Object.prototype.hasOwnProperty.call(ctx, name)) {
      v = ctx[name];
    } else {
      throw new EvaluationError(`Identifier '${name}' is undefined in context`);
    }
    if (v === undefined || v === null) {
      throw new EvaluationError(`Identifier '${name}' is undefined in context`);
    }
    if (typeof v !== 'number' || !Number.isFinite(v)) {
      throw new EvaluationError(`Identifier '${name}' must be a finite number (got ${v})`);
    }
    return v;
  }
  // Unreachable — parser whitelist blocks unknowns — but defend in depth.
  throw new EvaluationError(`Unknown identifier '${name}'`);
}

function resolveMember(namespace, member, ctx) {
  const ns = ctx[namespace];
  if (!ns || typeof ns !== 'object') {
    throw new EvaluationError(`Namespace '${namespace}' missing from context`);
  }
  // Use Object.prototype.hasOwnProperty to avoid prototype-chain access.
  // Without this, `ai.constructor` could resolve to Object.prototype.constructor.
  if (!Object.prototype.hasOwnProperty.call(ns, member)) {
    throw new EvaluationError(`Member '${namespace}.${member}' is undefined in context`);
  }
  const v = ns[member];
  if (v === undefined || v === null) {
    throw new EvaluationError(`Member '${namespace}.${member}' is undefined in context`);
  }
  if (typeof v !== 'number' || !Number.isFinite(v)) {
    throw new EvaluationError(`Member '${namespace}.${member}' must be a finite number (got ${v})`);
  }
  return v;
}

// ── Helpers ──

function assertNumber(v, label) {
  if (typeof v !== 'number' || !Number.isFinite(v)) {
    throw new EvaluationError(`${label} must be a finite number (got ${typeof v} '${v}')`);
  }
}

function strictEqual(a, b) {
  // Strict, type-aware equality. No coercion: 1 != "1".
  if (typeof a !== typeof b) return false;
  return a === b;
}

// ── Introspection helpers (for tests + tooling) ──

export function listAllowedIdentifiers() {
  const members = [];
  for (const [ns, set] of Object.entries(MEMBER_NAMESPACES)) {
    for (const m of set) members.push(`${ns}.${m}`);
  }
  return {
    root: [...ROOT_IDENTS].sort(),
    members: members.sort(),
    functions: Object.keys(FUNCTION_TABLE).sort(),
  };
}

// Test-only helper to reset the AST cache between tests.
export function _resetAstCache() {
  AST_CACHE.clear();
}
