import NextAuth from "next-auth";
import { NextResponse } from "next/server";
import { authConfig } from "@/lib/auth.config";
import { safeCallbackPath } from "@/lib/security/callbackUrl";
import { APPEARANCE_BOOTSTRAP } from "@/lib/appearanceBootstrap";
import { createNonce, securityHeaders, sha256Base64, type CspOptions } from "@/lib/security/headers";

// A separate, edge-safe NextAuth instance built only from the base config —
// see auth.config.ts for why this can't reuse the full auth.ts (which pulls
// in the `pg` driver via the database adapter and Credentials provider).
const { auth } = NextAuth(authConfig);

const isDev = process.env.NODE_ENV === "development";

/**
 * The digests of the app's own inline scripts, computed once per process.
 *
 * There is exactly one — the appearance bootstrap in the root layout — and its
 * source is fixed at build time, so hashing it per request would be pure
 * waste. See src/lib/security/headers.ts for why these are hashed rather than
 * nonced.
 */
let inlineScriptHashes: Promise<string[]> | null = null;
function scriptHashes(): Promise<string[]> {
  inlineScriptHashes ??= Promise.all([sha256Base64(APPEARANCE_BOOTSTRAP)]);
  return inlineScriptHashes;
}

/**
 * Applies the security headers to any response the proxy produces, and — for
 * responses that will be rendered — forwards the CSP and its nonce on the
 * *request* as well, which is how Next.js learns which nonce to stamp onto
 * its own script tags.
 */
function withSecurityHeaders(response: NextResponse, options: CspOptions): NextResponse {
  for (const [key, value] of Object.entries(securityHeaders(options))) {
    response.headers.set(key, value);
  }
  return response;
}

export default auth(async (req) => {
  const { pathname } = req.nextUrl;
  const isLoggedIn = !!req.auth;
  const isAppRoute = pathname.startsWith("/app");
  const isAuthPage = pathname === "/signin" || pathname === "/signup";
  // /api/auth/* is NextAuth's own surface (session, callbacks, sign-in) and
  // must stay reachable while signed out, or logging in becomes impossible.
  // /api/auth/register is the sign-up endpoint, likewise public by design.
  const isApiRoute = pathname.startsWith("/api") && !pathname.startsWith("/api/auth");

  const options: CspOptions = { nonce: createNonce(), isDev, scriptHashes: await scriptHashes() };
  const headers = securityHeaders(options);

  // These routes each spend Gemini/Groq quota or write to storage. Every
  // handler now also authenticates for itself (see requireUser in
  // src/lib/apiGuard.ts) — this is the outer perimeter, not the only one.
  if (isApiRoute && !isLoggedIn) {
    return withSecurityHeaders(
      NextResponse.json(
        { error: "You need to be signed in to do that.", kind: "auth" },
        { status: 401 }
      ),
      options
    );
  }

  if (isAppRoute && !isLoggedIn) {
    const signInUrl = new URL("/signin", req.nextUrl.origin);
    // Round-tripped through the same validator the sign-in page uses, so the
    // two can never disagree about what is an approved destination.
    signInUrl.searchParams.set("callbackUrl", safeCallbackPath(pathname));
    return withSecurityHeaders(NextResponse.redirect(signInUrl), options);
  }

  if (isAuthPage && isLoggedIn) {
    return withSecurityHeaders(NextResponse.redirect(new URL("/app", req.nextUrl.origin)), options);
  }

  // The nonce and policy travel on the request so Next.js can stamp the nonce
  // onto the scripts it renders; they are repeated on the response for the
  // browser to enforce.
  const requestHeaders = new Headers(req.headers);
  requestHeaders.set("x-nonce", options.nonce);
  requestHeaders.set("Content-Security-Policy", headers["Content-Security-Policy"]);

  return withSecurityHeaders(
    NextResponse.next({ request: { headers: requestHeaders } }),
    options
  );
});

export const config = {
  // Every document response needs the security headers, not just the gated
  // routes, so the matcher covers the whole site minus static assets — plus
  // /api explicitly, which the negative pattern excludes.
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:png|jpg|jpeg|gif|svg|ico|webp|woff2?)$).*)",
    "/api/:path*",
  ],
};
