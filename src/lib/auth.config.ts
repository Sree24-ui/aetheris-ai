import type { NextAuthConfig } from "next-auth";
import Google from "next-auth/providers/google";

// Edge-safe subset of the auth config: no database adapter, no Credentials
// provider (its `authorize` needs the `pg` driver, which isn't supported in
// the Edge Runtime that `middleware.ts` runs in by default). This is enough
// for middleware to decode/verify the JWT session cookie and gate routes —
// the full config (adapter + Credentials) lives in auth.ts and only runs in
// the Node.js runtime (route handlers, server components).
/**
 * Google OAuth is optional. Registered unconditionally it still appears in
 * /api/auth/providers, so the sign-in button rendered, and clicking it
 * redirected to /api/auth/error?error=Configuration — which is what a local
 * checkout without GOOGLE_CLIENT_ID/GOOGLE_CLIENT_SECRET always hits. Leaving
 * the provider out entirely lets the auth pages hide the button instead.
 */
export const GOOGLE_CONFIGURED = Boolean(
  process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET
);

export const authConfig: NextAuthConfig = {
  session: { strategy: "jwt" },
  pages: { signIn: "/signin" },
  /**
   * Auth.js refuses a request whose Host header it does not trust, which is
   * what produces `UntrustedHost` on a self-hosted deployment behind a proxy.
   * Vercel is auto-detected; anywhere else the operator opts in explicitly by
   * setting AUTH_TRUST_HOST=true, and must terminate TLS and set
   * X-Forwarded-Host correctly for that to be safe.
   */
  trustHost: process.env.AUTH_TRUST_HOST === "true" || Boolean(process.env.VERCEL),
  /**
   * Secure, host-prefixed cookies outside development. `useSecureCookies`
   * makes Auth.js apply the __Secure- / __Host- prefixes and the Secure flag,
   * which a browser only accepts over HTTPS — so it stays off locally. The
   * session cookie's httpOnly/sameSite=lax defaults are already correct and
   * are deliberately not overridden here.
   */
  useSecureCookies: process.env.NODE_ENV === "production",
  providers: GOOGLE_CONFIGURED
    ? [
        Google({
          clientId: process.env.GOOGLE_CLIENT_ID,
          clientSecret: process.env.GOOGLE_CLIENT_SECRET,
          // Without this, Google silently reuses whichever Google account is
          // already active in the browser and skips the account chooser, so
          // signing in again can re-authenticate as the same account even when
          // the user intends to switch — surfacing as "history never changes."
          authorization: { params: { prompt: "select_account" } },
        }),
      ]
    : [],
  callbacks: {
    async jwt({ token, user, trigger, session }) {
      if (user) token.id = user.id;
      // Lets the client push a fresh name into the JWT after a profile edit
      // (see ProfileDashboard's `update({ name })` call) without requiring
      // a full re-login.
      if (trigger === "update" && session?.name) token.name = session.name;
      return token;
    },
    async session({ session, token }) {
      if (session.user && token.id) session.user.id = token.id as string;
      return session;
    },
  },
};
