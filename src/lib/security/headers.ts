/**
 * The application's Content Security Policy and companion response headers.
 *
 * Kept out of proxy.ts so the policy itself can be asserted in tests: the
 * point of this file is that a future change cannot quietly reintroduce
 * `unsafe-eval` (which is what made the old `new Function` graph renderer
 * possible) or open `frame-ancestors` without a test failing.
 */

export interface CspOptions {
  /** Per-request nonce. Next.js applies it to its own scripts automatically. */
  nonce: string;
  /** React needs `unsafe-eval` for its dev-time error reconstruction only. */
  isDev: boolean;
}

/**
 * Hosts the app genuinely loads from. Material Symbols is still served by
 * Google Fonts; self-hosting it is tracked as follow-up work, and until then
 * the two font hosts must be named here or the icon font simply fails to
 * load under the policy.
 */
const GOOGLE_FONTS_STYLESHEET = "https://fonts.googleapis.com";
const GOOGLE_FONTS_FILES = "https://fonts.gstatic.com";
/** Where Google returns profile pictures for OAuth accounts. */
const GOOGLE_AVATARS = "https://lh3.googleusercontent.com";

export function contentSecurityPolicy({ nonce, isDev }: CspOptions): string {
  const directives = [
    "default-src 'self'",
    // 'strict-dynamic' means scripts loaded by a nonced script inherit trust,
    // which is how Next's chunk loading keeps working without listing every
    // bundle. No 'unsafe-inline', and no 'unsafe-eval' outside development.
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${isDev ? " 'unsafe-eval'" : ""}`,
    // 'unsafe-inline' is required for style *attributes*: the UI sets a
    // handful of computed values via React's `style={{...}}`, and a nonce
    // cannot cover an attribute. This is a far weaker concession than the
    // script equivalent — CSS cannot execute here, and every element that
    // could carry an active URL is stripped by the SVG sanitiser.
    `style-src 'self' 'unsafe-inline' ${GOOGLE_FONTS_STYLESHEET}`,
    `font-src 'self' data: ${GOOGLE_FONTS_FILES}`,
    `img-src 'self' blob: data: ${GOOGLE_AVATARS}`,
    // Recorded video previews are object URLs.
    "media-src 'self' blob:",
    "connect-src 'self'",
    "worker-src 'self' blob:",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-src 'none'",
    "frame-ancestors 'none'",
    "manifest-src 'self'",
  ];
  if (!isDev) directives.push("upgrade-insecure-requests");
  return directives.join("; ");
}

/**
 * Every security header the app sets, including the CSP. Returned as a plain
 * record so both the proxy and a test can enumerate it.
 */
export function securityHeaders(options: CspOptions): Record<string, string> {
  const headers: Record<string, string> = {
    "Content-Security-Policy": contentSecurityPolicy(options),
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
    "Referrer-Policy": "strict-origin-when-cross-origin",
    // Camera and microphone stay available to the app itself for the lesson
    // recorder; everything else is refused outright.
    "Permissions-Policy":
      "accelerometer=(), autoplay=(self), camera=(self), display-capture=(), geolocation=(), gyroscope=(), microphone=(self), payment=(), usb=()",
    "Cross-Origin-Opener-Policy": "same-origin",
    "X-DNS-Prefetch-Control": "off",
  };
  if (!options.isDev) {
    headers["Strict-Transport-Security"] = "max-age=63072000; includeSubDomains; preload";
  }
  return headers;
}

/** Cryptographically random, base64, fresh per request. */
export function createNonce(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return btoa(String.fromCharCode(...bytes));
}
