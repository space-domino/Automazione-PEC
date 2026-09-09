import { auth, signOut } from "@/lib/auth";
import { redirect } from "next/navigation";
import { SideNav } from "./side-nav";

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const session = await auth();
  if (!session?.user) redirect("/login");

  return (
    <div className="flex min-h-screen">
      <aside className="flex w-60 shrink-0 flex-col border-r border-[var(--border)] bg-[var(--surface)] px-3 py-4">
        <div className="mb-6 px-2">
          <div className="mono text-sm font-bold tracking-[0.14em] text-[var(--ink)]">
            SPACE<span className="text-[var(--accent)]">DOMINO</span>
          </div>
          <div className="mt-0.5 text-[11px] text-[var(--ink-faint)]">Console operativa</div>
        </div>

        <div className="flex-1 overflow-y-auto">
          <SideNav />
        </div>

        <form
          action={async () => {
            "use server";
            await signOut({ redirectTo: "/login" });
          }}
          className="mt-4 border-t border-[var(--border)] px-2 pt-3"
        >
          <div className="truncate text-[11px] text-[var(--ink-faint)]">{session.user.email}</div>
          <button
            type="submit"
            className="mt-1 text-xs text-[var(--ink-soft)] hover:text-[var(--danger)]"
          >
            Esci
          </button>
        </form>
      </aside>

      <main className="min-w-0 flex-1 px-8 py-7">
        <div className="mx-auto max-w-6xl">{children}</div>
      </main>
    </div>
  );
}
