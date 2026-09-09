import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import { LoginForm } from "./login-form";

export const dynamic = "force-dynamic";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ callbackUrl?: string }>;
}) {
  const session = await auth();
  if (session?.user) redirect("/dashboard");

  const { callbackUrl } = await searchParams;

  return (
    <div className="flex min-h-screen items-center justify-center bg-[var(--bg)] p-4">
      <div className="panel w-full max-w-sm p-7">
        <div className="mono mb-1 text-sm font-bold tracking-[0.14em]">
          SPACE<span className="text-[var(--accent)]">DOMINO</span>
        </div>
        <p className="mb-5 text-sm text-[var(--ink-soft)]">Console operativa — accesso riservato</p>
        <LoginForm callbackUrl={callbackUrl ?? "/dashboard"} />
      </div>
    </div>
  );
}
