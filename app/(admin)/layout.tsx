import { auth, signOut } from "@/lib/auth";
import Link from "next/link";
import { redirect } from "next/navigation";

// Le sezioni si aggiungono milestone per milestone.
const NAV = [
  { href: "/dashboard", label: "Overview" },
  { href: "/companies", label: "Aziende" },
  { href: "/domains", label: "Domini" },
  { href: "/import", label: "Import CSV" },
  { href: "/jobs", label: "Job" },
  { href: "/audit", label: "Audit" },
];

export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await auth();
  if (!session?.user) redirect("/login");

  return (
    <div className="flex min-h-screen">
      <aside className="w-56 shrink-0 border-r border-neutral-200 bg-white p-4">
        <div className="mb-6 text-sm font-semibold">Domain Reselling</div>
        <nav className="space-y-1">
          {NAV.map((n) => (
            <Link
              key={n.href}
              href={n.href}
              className="block rounded px-2 py-1.5 text-sm text-neutral-700 hover:bg-neutral-100"
            >
              {n.label}
            </Link>
          ))}
        </nav>
        <form
          action={async () => {
            "use server";
            await signOut({ redirectTo: "/login" });
          }}
          className="mt-8"
        >
          <button type="submit" className="text-xs text-neutral-500 hover:text-neutral-800">
            Esci ({session.user.email})
          </button>
        </form>
      </aside>
      <main className="flex-1 p-8">{children}</main>
    </div>
  );
}
