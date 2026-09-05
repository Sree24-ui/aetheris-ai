import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { contentSecurityPolicy, createNonce, securityHeaders, sha256Base64 } from "./headers";
import { APPEARANCE_BOOTSTRAP } from "../appearanceBootstrap";

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

// --- inline scripts allowed by hash rather than nonce ---------------------

/**
 * The appearance bootstrap runs before first paint and cannot carry a nonce:
 * the browser blanks a script's nonce attribute once the element is inserted
 * under an active CSP, so React hydrating it compared the nonce it expected
 * against an empty attribute and reported a mismatch on every load. Hashing
 * pins the exact bytes instead — and `strict-dynamic` keeps hashes in effect
 * even though it ignores host allowlists and `unsafe-inline`.
 */

test("sha256Base64 matches a known digest", async () => {
  assert.equal(await sha256Base64(""), "47DEQpj8HBSa+/TImW+5JCeuQeRkm5NMpJWZG3hSuFU=");
  assert.equal(
    await sha256Base64("abc"),
    createHash("sha256").update("abc").digest("base64")
  );
});

test("a hashed inline script is named in script-src", async () => {
  const hash = await sha256Base64(APPEARANCE_BOOTSTRAP);
  const scriptSrc = directive(
    contentSecurityPolicy({ nonce: "abc123", isDev: false, scriptHashes: [hash] }),
    "script-src"
  );
  assert.ok(scriptSrc.includes(`'sha256-${hash}'`), scriptSrc);
});

test("hashing an inline script concedes nothing else", async () => {
  const csp = contentSecurityPolicy({
    nonce: "abc123",
    isDev: false,
    scriptHashes: [await sha256Base64(APPEARANCE_BOOTSTRAP)],
  });
  const scriptSrc = directive(csp, "script-src");
  assert.ok(!scriptSrc.includes("'unsafe-inline'"), scriptSrc);
  assert.ok(!csp.includes("unsafe-eval"), csp);
  assert.ok(scriptSrc.includes("'strict-dynamic'"), scriptSrc);
  assert.ok(scriptSrc.includes("'nonce-abc123'"), scriptSrc);
});

test("the policy is unchanged when no inline script needs one", () => {
  assert.equal(
    contentSecurityPolicy({ nonce: "n", isDev: false }),
    contentSecurityPolicy({ nonce: "n", isDev: false, scriptHashes: [] })
  );
});

test("the bootstrap is a self-contained script, safe to hash", () => {
  // A hash pins bytes, so the source has to be fixed at build time: no
  // per-request value may be interpolated into it, and it must not be able to
  // break out of the script element it is rendered into.
  assert.ok(!APPEARANCE_BOOTSTRAP.includes("</script"), "would terminate the element early");
  assert.ok(APPEARANCE_BOOTSTRAP.startsWith("try{"), "runs without throwing into the page");
});
