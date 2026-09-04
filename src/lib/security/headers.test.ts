import { test } from "node:test";
import assert from "node:assert/strict";
import { contentSecurityPolicy, createNonce, securityHeaders } from "./headers";

/**
 * The policy is asserted directly because it is the control that keeps C1
 * closed for good: even if some future renderer reached for `eval`, the
 * browser would refuse to run it. A change that reintroduces `unsafe-eval`
 * (or opens framing, or drops the nonce) has to fail here first.
 */

function directive(csp: string, name: string): string {
  const found = csp.split("; ").find((part) => part.startsWith(`${name} `) || part === name);
  assert.ok(found, `missing directive: ${name}`);
  return found;
}

test("production CSP allows no eval and no inline script", () => {
  const csp = contentSecurityPolicy({ nonce: "abc123", isDev: false });
  assert.ok(!csp.includes("unsafe-eval"), csp);
  const scriptSrc = directive(csp, "script-src");
  assert.ok(!scriptSrc.includes("'unsafe-inline'"), scriptSrc);
  assert.ok(scriptSrc.includes("'nonce-abc123'"), scriptSrc);
  assert.ok(scriptSrc.includes("'strict-dynamic'"), scriptSrc);
});

test("development CSP adds eval only for React's dev tooling", () => {
  const dev = contentSecurityPolicy({ nonce: "abc123", isDev: true });
  assert.ok(dev.includes("'unsafe-eval'"));
  const prod = contentSecurityPolicy({ nonce: "abc123", isDev: false });
  assert.ok(!prod.includes("'unsafe-eval'"));
});

test("CSP closes the remaining active-content sinks", () => {
  const csp = contentSecurityPolicy({ nonce: "n", isDev: false });
  assert.equal(directive(csp, "object-src"), "object-src 'none'");
  assert.equal(directive(csp, "frame-ancestors"), "frame-ancestors 'none'");
  assert.equal(directive(csp, "frame-src"), "frame-src 'none'");
  assert.equal(directive(csp, "base-uri"), "base-uri 'self'");
  assert.equal(directive(csp, "form-action"), "form-action 'self'");
  assert.equal(directive(csp, "default-src"), "default-src 'self'");
  assert.equal(directive(csp, "connect-src"), "connect-src 'self'");
});

test("upgrade-insecure-requests is production-only", () => {
  assert.ok(contentSecurityPolicy({ nonce: "n", isDev: false }).includes("upgrade-insecure-requests"));
  assert.ok(!contentSecurityPolicy({ nonce: "n", isDev: true }).includes("upgrade-insecure-requests"));
});

test("the companion security headers are all present", () => {
  const headers = securityHeaders({ nonce: "n", isDev: false });
  assert.equal(headers["X-Content-Type-Options"], "nosniff");
  assert.equal(headers["X-Frame-Options"], "DENY");
  assert.equal(headers["Referrer-Policy"], "strict-origin-when-cross-origin");
  assert.equal(headers["Cross-Origin-Opener-Policy"], "same-origin");
  assert.ok(headers["Permissions-Policy"].includes("geolocation=()"));
  assert.ok(headers["Strict-Transport-Security"].startsWith("max-age="));
});

test("HSTS is not sent in development", () => {
  const headers = securityHeaders({ nonce: "n", isDev: true });
  assert.equal(headers["Strict-Transport-Security"], undefined);
});

test("nonces are unpredictable and unique per call", () => {
  const seen = new Set<string>();
  for (let i = 0; i < 200; i++) {
    const nonce = createNonce();
    assert.ok(nonce.length >= 16, nonce);
    assert.ok(!seen.has(nonce), "nonce repeated");
    seen.add(nonce);
  }
});
