/**
 * One shared validator for post-authentication redirect destinations.
 *
 * The sign-in page used to read `?callbackUrl=` and hand it straight to
 * `router.push` and to `signIn("google", { callbackUrl })`. A crafted link
 * could therefore bounce a freshly-authenticated learner to an attacker's
 * page, which is the classic phishing/credential-harvesting shape. Both the
 * client and the server now route every candidate through `safeCallbackPath`,
 * which returns an approved internal path or the default — it never returns
 * anything it was given verbatim without proving it is internal first.
 */

/** Where anything unrecognised lands. */
export const DEFAULT_CALLBACK_PATH = "/app";

/**
 * Internal destinations a callback may point at. A value must equal one of
 * these or be a sub-path of one (`/app/lesson/3`), so adding a route to the
 * app does not silently widen what a redirect can reach.
 */
export const ALLOWED_CALLBACK_ROOTS = Object.freeze(["/app"]);

/** Longest accepted raw value; anything longer is junk or an attack. */
const MAX_CALLBACK_LENGTH = 512;

/**
 * A base that cannot collide with any real origin. Resolving against it means
 * an absolute URL in the input keeps its own origin and is rejected below,
 * while a genuine relative path adopts this one.
 */
const SENTINEL_ORIGIN = "https://callback-validation.invalid";

/** C0 controls plus DEL — browsers strip several of these before parsing. */
const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f]/;

function isAllowedPathname(pathname: string): boolean {
  return ALLOWED_CALLBACK_ROOTS.some(
    (root) => pathname === root || pathname.startsWith(`${root}/`)
  );
}

/**
 * Normalises a candidate callback destination to a safe internal path.
 *
 * Rejects (returning the fallback): non-strings, absolute URLs of any scheme,
 * protocol-relative `//host` values, backslash variants that some browsers
 * normalise to `/`, embedded credentials, control characters, percent-encoded
 * forms of all of the above, and any internal path outside
 * ALLOWED_CALLBACK_ROOTS.
 */
export function safeCallbackPath(
  raw: unknown,
  fallback: string = DEFAULT_CALLBACK_PATH
): string {
  if (typeof raw !== "string") return fallback;

  const candidate = raw.trim();
  if (candidate.length === 0 || candidate.length > MAX_CALLBACK_LENGTH) return fallback;

  // Control characters are how `java\nscript:` sneaks past a naive scheme
  // check: the browser strips the newline only after the check has run.
  if (CONTROL_CHARACTERS.test(candidate)) return fallback;

  // A backslash is never legitimate here and several browsers treat it as a
  // path separator, so `/\evil.com` becomes `//evil.com`.
  if (candidate.includes("\\")) return fallback;

  // Must be root-relative, and must not be protocol-relative.
  if (!candidate.startsWith("/") || candidate.startsWith("//")) return fallback;

  // Percent-encoded separators are checked before parsing: `/%2f%2fevil.com`
  // and `/%5c%5cevil.com` are rejected rather than normalised into something
  // that depends on which layer decodes first.
  let decoded: string;
  try {
    decoded = decodeURIComponent(candidate);
  } catch {
    // Malformed encoding — refuse rather than guess.
    return fallback;
  }
  if (decoded.includes("\\") || decoded.startsWith("//")) return fallback;
  if (CONTROL_CHARACTERS.test(decoded)) return fallback;

  let url: URL;
  try {
    url = new URL(candidate, SENTINEL_ORIGIN);
  } catch {
    return fallback;
  }

  // An absolute input keeps its own origin; only a genuinely relative one
  // inherits the sentinel.
  if (url.origin !== SENTINEL_ORIGIN) return fallback;
  if (url.username || url.password) return fallback;
  if (!isAllowedPathname(url.pathname)) return fallback;

  // Rebuilt from the parsed pieces rather than echoed back, so nothing that
  // survived parsing by accident can be reflected into a redirect.
  return `${url.pathname}${url.search}`;
}

/**
 * Absolute form of the same destination, for APIs (NextAuth's `callbackUrl`,
 * `Response.redirect`) that require one. The origin always comes from the
 * caller, never from the untrusted value.
 */
export function safeCallbackUrl(raw: unknown, origin: string): string {
  return new URL(safeCallbackPath(raw), origin).toString();
}
