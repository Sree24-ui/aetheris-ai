import type { NextAuthConfig } from "next-auth";
import Google from "next-auth/providers/google";

// Edge-safe subset of the auth config: no database adapter, no Credentials
// provider (its `authorize` needs the `pg` driver, which isn't supported in
// the Edge Runtime that `middleware.ts` runs in by default). This is enough
// for middleware to decode/verify the JWT session cookie and gate routes —
// the full config (adapter + Credentials) lives in auth.ts and only runs in
// the Node.js runtime (route handlers, server components).
export const authConfig: NextAuthConfig = {
  session: { strategy: "jwt" },
  pages: { signIn: "/signin" },
  providers: [
    Google({
      clientId: process.env.GOOGLE_CLIENT_ID,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET,
    }),
  ],
  callbacks: {
    async jwt({ token, user }) {
      if (user) token.id = user.id;
      return token;
    },
    async session({ session, token }) {
      if (session.user && token.id) session.user.id = token.id as string;
      return session;
    },
  },
};
