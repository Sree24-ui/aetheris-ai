import NextAuth from "next-auth";
import { NextResponse } from "next/server";
import { authConfig } from "@/lib/auth.config";

// A separate, edge-safe NextAuth instance built only from the base config —
// see auth.config.ts for why this can't reuse the full auth.ts (which pulls
// in the `pg` driver via the database adapter and Credentials provider).
const { auth } = NextAuth(authConfig);

export default auth((req) => {
  const { pathname } = req.nextUrl;
  const isLoggedIn = !!req.auth;
  const isAppRoute = pathname.startsWith("/app");
  const isAuthPage = pathname === "/signin" || pathname === "/signup";
  // /api/auth/* is NextAuth's own surface (session, callbacks, sign-in) and
  // must stay reachable while signed out, or logging in becomes impossible.
  // /api/auth/register is the sign-up endpoint, likewise public by design.
  const isApiRoute = pathname.startsWith("/api") && !pathname.startsWith("/api/auth");

  // These routes each spend Gemini/Groq quota or write to storage. Leaving
  // them open meant anyone with the deployed URL could drain the account's
  // daily model budget in a loop, so they are gated here rather than relying
  // on each handler to remember.
  if (isApiRoute && !isLoggedIn) {
    return NextResponse.json(
      { error: "You need to be signed in to do that.", kind: "auth" },
      { status: 401 }
    );
  }

  if (isAppRoute && !isLoggedIn) {
    const signInUrl = new URL("/signin", req.nextUrl.origin);
    signInUrl.searchParams.set("callbackUrl", pathname);
    return NextResponse.redirect(signInUrl);
  }

  if (isAuthPage && isLoggedIn) {
    return NextResponse.redirect(new URL("/app", req.nextUrl.origin));
  }

  return NextResponse.next();
});

export const config = {
  matcher: ["/app/:path*", "/signin", "/signup", "/api/:path*"],
};
