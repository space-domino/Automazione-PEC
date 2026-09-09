import Link from "next/link";
import type { ReactNode } from "react";

export function PageHeader({
  title,
  sub,
  actions,
  back,
}: {
  title: ReactNode;
  sub?: ReactNode;
  actions?: ReactNode;
  back?: { href: string; label: string };
}) {
  return (
    <div className="mb-5">
      {back && (
        <Link
          href={back.href}
          className="mb-1 inline-block text-xs text-[var(--ink-soft)] hover:underline"
        >
          ← {back.label}
        </Link>
      )}
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="page-title">{title}</h1>
          {sub && <p className="page-sub">{sub}</p>}
        </div>
        {actions && <div className="flex items-center gap-2">{actions}</div>}
      </div>
    </div>
  );
}

export function Card({
  title,
  children,
  className = "",
}: {
  title?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={`panel overflow-hidden ${className}`}>
      {title && (
        <header className="border-b border-[var(--border)] bg-[var(--surface-2)] px-3 py-2 text-xs font-medium text-[var(--ink-faint)]">
          {title}
        </header>
      )}
      {children}
    </section>
  );
}

export function TableWrap({ children }: { children: ReactNode }) {
  return (
    <div className="panel overflow-x-auto">
      <table className="dtable">{children}</table>
    </div>
  );
}

export function EmptyRow({ cols, children }: { cols: number; children: ReactNode }) {
  return (
    <tr>
      <td colSpan={cols} className="px-3 py-10 text-center text-sm text-[var(--ink-faint)]">
        {children}
      </td>
    </tr>
  );
}

/** valore grande + etichetta, per le strisce metriche */
export function Metric({
  label,
  value,
  hint,
  accent,
}: {
  label: string;
  value: ReactNode;
  hint?: ReactNode;
  accent?: boolean;
}) {
  return (
    <div className="panel px-3 py-2.5">
      <div className={`text-xl font-semibold tabular-nums ${accent ? "text-[var(--accent)]" : ""}`}>
        {value}
      </div>
      <div className="text-xs text-[var(--ink-soft)]">{label}</div>
      {hint && <div className="mt-0.5 text-[11px] text-[var(--ink-faint)]">{hint}</div>}
    </div>
  );
}
