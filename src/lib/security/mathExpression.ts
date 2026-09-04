/**
 * A deliberately tiny mathematical expression language for model-generated
 * graph specs.
 *
 * GraphCanvas used to evaluate `graph.expression` with `new Function`, which
 * made every LLM response (and, through RAG, every uploaded document) a script
 * injection vector in the learner's browser. Nothing here can produce code:
 * the input is tokenised, parsed into a small AST of known node kinds, and
 * evaluated by walking that AST. There is no `eval`, no `new Function`, no
 * property access, no assignment, no statement, and no way to name anything
 * that is not in ALLOWED_FUNCTIONS / CONSTANTS below.
 *
 * Every limit here exists to bound work as well as capability: a hostile
 * expression must not be able to hang the render loop either.
 */

/** Longest accepted source string. Real graph expressions are far shorter. */
export const MAX_EXPRESSION_LENGTH = 256;
/** Longest accepted token stream. */
export const MAX_TOKENS = 200;
/** Deepest accepted parenthesis / call nesting. */
export const MAX_DEPTH = 24;
/** Largest accepted AST. Bounds evaluation cost per sample. */
export const MAX_NODES = 200;
/** Results outside this magnitude are treated as "no value here". */
export const MAX_ABS_RESULT = 1e12;

type Unary = (a: number) => number;
type Binary = (a: number, b: number) => number;

/** `ln` is aliased to natural log because models write both spellings. */
const UNARY_FUNCTIONS: Record<string, Unary> = {
  sin: Math.sin,
  cos: Math.cos,
  tan: Math.tan,
  asin: Math.asin,
  acos: Math.acos,
  atan: Math.atan,
  sinh: Math.sinh,
  cosh: Math.cosh,
  tanh: Math.tanh,
  sqrt: Math.sqrt,
  cbrt: Math.cbrt,
  abs: Math.abs,
  exp: Math.exp,
  log: Math.log,
  ln: Math.log,
  log2: Math.log2,
  log10: Math.log10,
  floor: Math.floor,
  ceil: Math.ceil,
  round: Math.round,
  trunc: Math.trunc,
  sign: Math.sign,
};

const BINARY_FUNCTIONS: Record<string, Binary> = {
  pow: Math.pow,
  atan2: Math.atan2,
  min: Math.min,
  max: Math.max,
  mod: (a, b) => a % b,
};

const CONSTANTS: Record<string, number> = {
  pi: Math.PI,
  e: Math.E,
  tau: Math.PI * 2,
};

/** The only variable an expression may reference. */
const VARIABLE = "x";

export const ALLOWED_FUNCTIONS = Object.freeze([
  ...Object.keys(UNARY_FUNCTIONS),
  ...Object.keys(BINARY_FUNCTIONS),
]);

export class ExpressionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ExpressionError";
  }
}

// --- Tokeniser ------------------------------------------------------------

type TokenType = "number" | "name" | "op" | "(" | ")" | ",";

interface Token {
  type: TokenType;
  value: string;
}

const OPERATORS = new Set(["+", "-", "*", "/", "%", "^"]);

function tokenize(source: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  while (i < source.length) {
    const ch = source[i];

    if (ch === " " || ch === "\t" || ch === "\n" || ch === "\r") {
      i += 1;
      continue;
    }

    if (ch >= "0" && ch <= "9") {
      let j = i;
      while (j < source.length && source[j] >= "0" && source[j] <= "9") j += 1;
      if (source[j] === ".") {
        j += 1;
        while (j < source.length && source[j] >= "0" && source[j] <= "9") j += 1;
      }
      // Exponent form (1e-3). Only digits may follow, so `1e` alone is a
      // syntax error rather than a reference to the constant `e`.
      if (source[j] === "e" || source[j] === "E") {
        let k = j + 1;
        if (source[k] === "+" || source[k] === "-") k += 1;
        if (source[k] >= "0" && source[k] <= "9") {
          k += 1;
          while (k < source.length && source[k] >= "0" && source[k] <= "9") k += 1;
          j = k;
        }
      }
      tokens.push({ type: "number", value: source.slice(i, j) });
      i = j;
      continue;
    }

    if (ch === "." && source[i + 1] >= "0" && source[i + 1] <= "9") {
      let j = i + 1;
      while (j < source.length && source[j] >= "0" && source[j] <= "9") j += 1;
      tokens.push({ type: "number", value: source.slice(i, j) });
      i = j;
      continue;
    }

    if (/[A-Za-z_]/.test(ch)) {
      let j = i;
      while (j < source.length && /[A-Za-z0-9_]/.test(source[j])) j += 1;
      let name = source.slice(i, j);
      // Compatibility shim, NOT general property access: models were asked
      // for "JS-evaluable" expressions for a long time and still emit
      // `Math.sin(x)`. A leading `Math.` before an allow-listed name is
      // accepted and stripped here; any other dot is a syntax error below,
      // so `window.x` or `a.b` can never parse.
      if (name === "Math" && source[j] === "." && /[A-Za-z_]/.test(source[j + 1] ?? "")) {
        let k = j + 1;
        while (k < source.length && /[A-Za-z0-9_]/.test(source[k])) k += 1;
        name = source.slice(j + 1, k);
        j = k;
      }
      tokens.push({ type: "name", value: name });
      i = j;
      continue;
    }

    if (OPERATORS.has(ch)) {
      // `**` is written by some models; fold it onto the `^` power operator.
      if (ch === "*" && source[i + 1] === "*") {
        tokens.push({ type: "op", value: "^" });
        i += 2;
        continue;
      }
      tokens.push({ type: "op", value: ch });
      i += 1;
      continue;
    }

    if (ch === "(" || ch === ")" || ch === ",") {
      tokens.push({ type: ch as TokenType, value: ch });
      i += 1;
      continue;
    }

    throw new ExpressionError(`Unexpected character "${ch}"`);
  }

  if (tokens.length > MAX_TOKENS) {
    throw new ExpressionError(`Expression has too many tokens (limit ${MAX_TOKENS})`);
  }
  return tokens;
}

// --- AST ------------------------------------------------------------------

type Node =
  | { kind: "const"; value: number }
  | { kind: "var" }
  | { kind: "unary"; op: "-" | "+"; operand: Node }
  | { kind: "binary"; op: string; left: Node; right: Node }
  | { kind: "call1"; fn: Unary; arg: Node }
  | { kind: "call2"; fn: Binary; a: Node; b: Node };

class Parser {
  private pos = 0;
  private nodes = 0;
  // Written out rather than declared as a constructor parameter property:
  // Node's type-stripping test runner rejects that syntax, and the test suite
  // runs this file directly.
  private readonly tokens: Token[];

  constructor(tokens: Token[]) {
    this.tokens = tokens;
  }

  parse(): Node {
    const node = this.parseExpression(0);
    if (this.pos < this.tokens.length) {
      throw new ExpressionError(`Unexpected "${this.tokens[this.pos].value}"`);
    }
    return node;
  }

  private count(): void {
    this.nodes += 1;
    if (this.nodes > MAX_NODES) {
      throw new ExpressionError(`Expression is too complex (limit ${MAX_NODES} nodes)`);
    }
  }

  private peek(): Token | undefined {
    return this.tokens[this.pos];
  }

  private expect(type: TokenType): Token {
    const token = this.tokens[this.pos];
    if (!token || token.type !== type) {
      throw new ExpressionError(`Expected "${type}"`);
    }
    this.pos += 1;
    return token;
  }

  /** Additive level, delegating to multiplicative then power then unary. */
  private parseExpression(depth: number): Node {
    if (depth > MAX_DEPTH) {
      throw new ExpressionError(`Expression nests too deeply (limit ${MAX_DEPTH})`);
    }
    let left = this.parseTerm(depth);
    for (;;) {
      const token = this.peek();
      if (!token || token.type !== "op" || (token.value !== "+" && token.value !== "-")) break;
      this.pos += 1;
      const right = this.parseTerm(depth);
      this.count();
      left = { kind: "binary", op: token.value, left, right };
    }
    return left;
  }

  private parseTerm(depth: number): Node {
    let left = this.parsePower(depth);
    for (;;) {
      const token = this.peek();
      if (
        !token ||
        token.type !== "op" ||
        (token.value !== "*" && token.value !== "/" && token.value !== "%")
      ) {
        break;
      }
      this.pos += 1;
      const right = this.parsePower(depth);
      this.count();
      left = { kind: "binary", op: token.value, left, right };
    }
    return left;
  }

  /** `^` is right-associative, matching ordinary mathematical notation. */
  private parsePower(depth: number): Node {
    const base = this.parseUnary(depth);
    const token = this.peek();
    if (token && token.type === "op" && token.value === "^") {
      this.pos += 1;
      const exponent = this.parsePower(depth + 1);
      this.count();
      return { kind: "binary", op: "^", left: base, right: exponent };
    }
    return base;
  }

  private parseUnary(depth: number): Node {
    const token = this.peek();
    if (token && token.type === "op" && (token.value === "-" || token.value === "+")) {
      this.pos += 1;
      const operand = this.parseUnary(depth + 1);
      this.count();
      return { kind: "unary", op: token.value as "-" | "+", operand };
    }
    return this.parsePrimary(depth);
  }

  private parsePrimary(depth: number): Node {
    const token = this.peek();
    if (!token) throw new ExpressionError("Unexpected end of expression");

    if (token.type === "number") {
      this.pos += 1;
      const value = Number(token.value);
      if (!Number.isFinite(value)) throw new ExpressionError(`Invalid number "${token.value}"`);
      this.count();
      return { kind: "const", value };
    }

    if (token.type === "(") {
      this.pos += 1;
      const inner = this.parseExpression(depth + 1);
      this.expect(")");
      return inner;
    }

    if (token.type === "name") {
      this.pos += 1;
      const name = token.value;
      const next = this.peek();

      if (next && next.type === "(") {
        const unary = Object.prototype.hasOwnProperty.call(UNARY_FUNCTIONS, name)
          ? UNARY_FUNCTIONS[name]
          : undefined;
        const binary = Object.prototype.hasOwnProperty.call(BINARY_FUNCTIONS, name)
          ? BINARY_FUNCTIONS[name]
          : undefined;
        if (!unary && !binary) {
          throw new ExpressionError(`Unknown function "${name}"`);
        }
        this.pos += 1;
        const first = this.parseExpression(depth + 1);
        if (this.peek()?.type === ",") {
          this.pos += 1;
          const second = this.parseExpression(depth + 1);
          this.expect(")");
          if (!binary) throw new ExpressionError(`"${name}" takes one argument`);
          this.count();
          return { kind: "call2", fn: binary, a: first, b: second };
        }
        this.expect(")");
        if (unary) {
          this.count();
          return { kind: "call1", fn: unary, arg: first };
        }
        throw new ExpressionError(`"${name}" takes two arguments`);
      }

      if (name === VARIABLE) {
        this.count();
        return { kind: "var" };
      }
      if (Object.prototype.hasOwnProperty.call(CONSTANTS, name)) {
        this.count();
        return { kind: "const", value: CONSTANTS[name] };
      }
      throw new ExpressionError(`Unknown name "${name}"`);
    }

    throw new ExpressionError(`Unexpected "${token.value}"`);
  }
}

function evaluate(node: Node, x: number): number {
  switch (node.kind) {
    case "const":
      return node.value;
    case "var":
      return x;
    case "unary":
      return node.op === "-" ? -evaluate(node.operand, x) : evaluate(node.operand, x);
    case "binary": {
      const a = evaluate(node.left, x);
      const b = evaluate(node.right, x);
      switch (node.op) {
        case "+":
          return a + b;
        case "-":
          return a - b;
        case "*":
          return a * b;
        case "/":
          return a / b;
        case "%":
          return a % b;
        case "^":
          return Math.pow(a, b);
        default:
          return NaN;
      }
    }
    case "call1":
      return node.fn(evaluate(node.arg, x));
    case "call2":
      return node.fn(evaluate(node.a, x), evaluate(node.b, x));
  }
}

export interface CompiledExpression {
  /** Evaluates at `x`, returning NaN for anything not a plottable number. */
  (x: number): number;
}

/**
 * Parses `source` into a callable. Throws ExpressionError — never executes any
 * part of `source` — when the expression is not in the supported language.
 */
export function compileExpression(source: unknown): CompiledExpression {
  if (typeof source !== "string") {
    throw new ExpressionError("Expression must be a string");
  }
  const trimmed = source.trim();
  if (trimmed.length === 0) {
    throw new ExpressionError("Expression is empty");
  }
  if (trimmed.length > MAX_EXPRESSION_LENGTH) {
    throw new ExpressionError(`Expression is too long (limit ${MAX_EXPRESSION_LENGTH} characters)`);
  }
  const ast = new Parser(tokenize(trimmed)).parse();
  return (x: number) => {
    const y = evaluate(ast, x);
    // A plot only ever wants a real, finite, drawable number. Everything else
    // (NaN, ±Infinity, absurd magnitudes) becomes a gap in the curve.
    if (typeof y !== "number" || !Number.isFinite(y) || Math.abs(y) > MAX_ABS_RESULT) {
      return NaN;
    }
    return y;
  };
}

/** Non-throwing form, for render paths that need a safe failure state. */
export function tryCompileExpression(
  source: unknown
): { ok: true; evaluate: CompiledExpression } | { ok: false; error: string } {
  try {
    return { ok: true, evaluate: compileExpression(source) };
  } catch (err) {
    return { ok: false, error: err instanceof ExpressionError ? err.message : "Invalid expression" };
  }
}
