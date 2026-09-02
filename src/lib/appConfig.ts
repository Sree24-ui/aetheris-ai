// Single source of truth for app-level identity and shared limits, so the
// product name and password rules can't drift between files.

export const APP_NAME = "Aetheris AI";

export const APP_DESCRIPTION = "A human-like AI educator that teaches through video";

// Public base URL of the deployment. NEXT_PUBLIC_SITE_URL wins (custom
// domain), then Vercel's own auto-populated production URL, then localhost
// for development. Server-only vars simply resolve to undefined on the
// client, where the public var (or the localhost fallback) applies.
export const APP_URL =
  process.env.NEXT_PUBLIC_SITE_URL ||
  (process.env.VERCEL_PROJECT_PRODUCTION_URL
    ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`
    : "http://localhost:3000");

// Shared between the signup form (client) and the register API route (server)
// so the two can't drift out of sync.
export const MIN_PASSWORD_LENGTH = 8;
