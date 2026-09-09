import { authConfig } from "@/lib/auth/config";
import NextAuth from "next-auth";
import { NextResponse } from "next/server";

const { auth } = NextAuth(authConfig);

/**
 * Prefissi raggiungibili SENZA login (sezione G.13).
 * Il rate-limit degli endpoint pubblici vive negli handler (runtime node),
 * non qui (il middleware gira su edge, senza Redis).
 */
const PUBLIC_PREFIXES = [
  "/login",
  "/api/auth",
  "/api/health",
  "/api/checkout",
  "/api/stripe/webhook",
  "/api/opt-out",
  "/api/public", // API pubblica catalogo (M7)
  "/api/delivery", // pagina di consegna dominio, token firmato (M11)
  "/domini", // landing pubbliche (M7)
];

function isPublic(pathname: string): boolean {
  return PUBLIC_PREFIXES.some((p) => pathname === p || pathname.startsWith(`${p}/`));
}

export default auth((req) => {
  const { pathname } = req.nextUrl;
  const requestId = crypto.randomUUID();

  if (!isPublic(pathname) && !req.auth) {
    if (pathname.startsWith("/api/")) {
      return NextResponse.json(
        { error: { code: "UNAUTHORIZED", message: "Autenticazione richiesta", requestId } },
        { status: 401, headers: { "x-request-id": requestId } },
      );
    }
    const url = new URL("/login", req.nextUrl.origin);
    url.searchParams.set("callbackUrl", pathname);
    return NextResponse.redirect(url);
  }

  const res = NextResponse.next();
  res.headers.set("x-request-id", requestId);
  return res;
});

export const config = {
  // tutto tranne asset statici di Next
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)",
  ],
};
