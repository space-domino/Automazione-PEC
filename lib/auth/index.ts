import { rateLimit } from "@/lib/api/rate-limit";
import { db } from "@/lib/db";
import { logger } from "@/lib/logger";
import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import { z } from "zod";
import { authConfig } from "./config";
import { verifyPassword } from "./password";

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

export const { handlers, auth, signIn, signOut } = NextAuth({
  ...authConfig,
  providers: [
    Credentials({
      credentials: { email: {}, password: {} },
      authorize: async (raw) => {
        const parsed = loginSchema.safeParse(raw);
        if (!parsed.success) return null;
        const email = parsed.data.email.toLowerCase();

        // Anti brute-force: 5 tentativi / 15 min per email (fail-open se Redis è giù).
        const rl = await rateLimit(`login:${email}`, 5, 15 * 60);
        if (!rl.ok) {
          logger.warn({ email }, "login: rate limit superato");
          return null;
        }

        const user = await db.user.findUnique({ where: { email } });
        if (!user || !user.isActive || !user.passwordHash) return null;

        const ok = await verifyPassword(user.passwordHash, parsed.data.password);
        if (!ok) {
          logger.warn({ email }, "login: password errata");
          return null;
        }

        await db.user.update({
          where: { id: user.id },
          data: { lastLoginAt: new Date() },
        });

        return {
          id: user.id,
          email: user.email,
          name: user.name ?? undefined,
          role: user.role,
        };
      },
    }),
  ],
});
