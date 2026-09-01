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
  matcher: ["/app/:path*", "/signin", "/signup"],
};
