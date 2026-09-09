import type { DefaultSession } from "next-auth";

// Ruoli allineati all'enum Prisma UserRole (senza importare @prisma/client nel bundle edge).
type AppRole = "ADMIN" | "OPERATOR" | "VIEWER";

declare module "next-auth" {
  interface User {
    role?: AppRole;
  }
  interface Session {
    user: {
      id: string;
      role?: AppRole;
    } & DefaultSession["user"];
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    id?: string;
    role?: AppRole;
  }
}
