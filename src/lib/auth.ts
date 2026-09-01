import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import PostgresAdapter from "@auth/pg-adapter";
import bcrypt from "bcryptjs";
import { pool } from "./db";
import { authConfig } from "./auth.config";

// Full config: adds the Postgres adapter and the Credentials provider (which
// queries the database directly in `authorize`) on top of the edge-safe base
// config. This file must only be imported from Node.js runtime code (route
// handlers, server components) — never from middleware.ts.
export const { handlers, auth, signIn, signOut } = NextAuth({
  ...authConfig,
  adapter: PostgresAdapter(pool),
  providers: [
    ...authConfig.providers,
    Credentials({
      name: "credentials",
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" },
      },
      async authorize(credentials) {
        const email = credentials?.email;
        const password = credentials?.password;
        if (typeof email !== "string" || typeof password !== "string") return null;

        const { rows } = await pool.query(
          `SELECT id, name, email, password, image FROM users WHERE email = $1`,
          [email.toLowerCase().trim()]
        );
        const user = rows[0];
        if (!user || !user.password) return null;

        const valid = await bcrypt.compare(password, user.password);
        if (!valid) return null;

        return { id: String(user.id), name: user.name, email: user.email, image: user.image };
      },
    }),
  ],
});
