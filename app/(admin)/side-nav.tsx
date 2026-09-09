"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const GROUPS: { title: string; items: { href: string; label: string }[] }[] = [
  {
    title: "Pipeline",
    items: [
      { href: "/dashboard", label: "Panoramica" },
      { href: "/companies", label: "Aziende" },
      { href: "/domains", label: "Domini" },
      { href: "/offers", label: "Offerte" },
    ],
  },
  {
    title: "Vendite",
    items: [
      { href: "/communications", label: "PEC" },
      { href: "/templates", label: "Template" },
      { href: "/sales", label: "Ordini" },
      { href: "/transfers", label: "Trasferimenti" },
    ],
  },
  {
    title: "Sistema",
    items: [
      { href: "/notifications", label: "Notifiche" },
      { href: "/jobs", label: "Job" },
      { href: "/audit", label: "Registro" },
      { href: "/import", label: "Import CSV" },
    ],
  },
];

export function SideNav() {
  const path = usePathname();
  return (
    <nav className="space-y-5">
      {GROUPS.map((g) => (
        <div key={g.title}>
          <div className="mb-1 px-2 text-[11px] font-medium tracking-wide text-[var(--ink-faint)]">
            {g.title}
          </div>
          <div className="space-y-0.5">
            {g.items.map((it) => {
              const active = path === it.href || path.startsWith(`${it.href}/`);
              return (
                <Link
                  key={it.href}
                  href={it.href}
                  aria-current={active ? "page" : undefined}
                  className={`block rounded-md px-2 py-1.5 text-sm ${
                    active
                      ? "bg-[var(--accent-soft)] font-medium text-[var(--accent)]"
                      : "text-[var(--ink-soft)] hover:bg-[var(--surface-2)] hover:text-[var(--ink)]"
                  }`}
                >
                  {it.label}
                </Link>
              );
            })}
          </div>
        </div>
      ))}
    </nav>
  );
}
