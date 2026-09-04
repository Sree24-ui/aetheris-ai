import { test } from "node:test";
import assert from "node:assert/strict";
import { safeCallbackPath, safeCallbackUrl, DEFAULT_CALLBACK_PATH } from "./callbackUrl";

/**
 * Regression tests for C2. `?callbackUrl=` used to reach `router.push` and
 * `signIn("google", { callbackUrl })` unvalidated, so every entry in
 * `openRedirects` was a working post-authentication redirect to an attacker's
 * page. All of them must now land on the default.
 */

const openRedirects = [
  "https://evil.example",
  "http://evil.example/app",
  "//evil.example",
  "//evil.example/app",
  "\\\\evil.example",
  "/\\evil.example",
  "/\\/evil.example",
  "\\/evil.example",
  "https:/evil.example",
  "https:evil.example",
  "javascript:alert(1)",
  "JavaScript:alert(1)",
  "  javascript:alert(1)  ",
  "java\nscript:alert(1)",
  "java\tscript:alert(1)",
  "data:text/html,<script>alert(1)</script>",
  "vbscript:msgbox(1)",
  "/%2f%2fevil.example",
  "/%5c%5cevil.example",
  "/%09/evil.example",
  "%2f%2fevil.example",
  "https://user:pass@evil.example",
  "/app@evil.example".replace("/app", "//app"),
  "///evil.example",
  "/..//evil.example",
  "file:///etc/passwd",
  "mailto:someone@example.com",
  "/%",
  "/%zz",
];

for (const value of openRedirects) {
  test(`rejects open redirect ${JSON.stringify(value)}`, () => {
    assert.equal(safeCallbackPath(value), DEFAULT_CALLBACK_PATH);
  });
}

test("rejects non-string values", () => {
  for (const value of [null, undefined, 42, {}, [], true]) {
    assert.equal(safeCallbackPath(value), DEFAULT_CALLBACK_PATH);
  }
});

test("rejects an over-long value", () => {
  assert.equal(safeCallbackPath("/app/" + "a".repeat(600)), DEFAULT_CALLBACK_PATH);
});

test("rejects internal paths outside the allow-list", () => {
  for (const value of ["/", "/signin", "/signup", "/api/history", "/admin"]) {
    assert.equal(safeCallbackPath(value), DEFAULT_CALLBACK_PATH);
  }
});

test("accepts approved internal paths", () => {
  assert.equal(safeCallbackPath("/app"), "/app");
  assert.equal(safeCallbackPath("/app/"), "/app/");
  assert.equal(safeCallbackPath("/app/lesson/3"), "/app/lesson/3");
});

test("preserves a query string on an approved path", () => {
  assert.equal(safeCallbackPath("/app?topic=algebra"), "/app?topic=algebra");
});

test("drops the fragment rather than reflecting it", () => {
  assert.equal(safeCallbackPath("/app#anything"), "/app");
});

test("honours an explicit fallback", () => {
  assert.equal(safeCallbackPath("https://evil.example", "/app/home"), "/app/home");
});

test("safeCallbackUrl always builds on the caller's origin", () => {
  assert.equal(
    safeCallbackUrl("https://evil.example/steal", "https://aetheris.example"),
    "https://aetheris.example/app"
  );
  assert.equal(
    safeCallbackUrl("/app/lesson/1", "https://aetheris.example"),
    "https://aetheris.example/app/lesson/1"
  );
});
