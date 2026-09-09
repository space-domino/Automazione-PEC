import type { NextAuthConfig } from "next-auth";

/**
 * Config Auth.js EDGE-SAFE: usata dal middleware.
 * Niente adapter, niente argon2, niente Prisma qui -> non finiscono nel bundle edge.
 * I provider (Credentials + verifica password) vivono in lib/auth/index.ts (runtime node).
 *
 * Strategia sessione: JWT. Il provider Credentials di Auth.js v5 non supporta le
 * sessioni su DB. Revoca "hard" lato server rimandata (M12); per ora maxAge 8h.
 */
type AppRole = "ADMIN" | "OPERATOR" | "VIEWER";

export const authConfig = {
  trustHost: true,
  pages: {
    signIn: "/login",
  },
  session: {
    strategy: "jwt",
    maxAge: 60 * 60 * 8,
  },
  providers: [],
  callbacks: {
    authorized({ auth }) {
      return Boolean(auth?.user);
    },
    jwt({ token, user }) {
      // Le augmentation dei tipi Auth.js v5 sul JWT sono ballerine in beta:
      // manteniamo le assegnazioni tramite un cast locale controllato.
      const t = token as typeof token & { id?: string; role?: AppRole };
      if (user) {
        const u = user as { id?: string; role?: AppRole };
        t.id = u.id;
        t.role = u.role;
      }
      return t;
    },
    session({ session, token }) {
      const t = token as { id?: string; role?: AppRole };
      if (session.user) {
        session.user.id = t.id ?? session.user.id;
        session.user.role = t.role;
      }
      return session;
    },
  },
} satisfies NextAuthConfig;
