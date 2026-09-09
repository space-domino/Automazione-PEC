"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";

function useUrlUpdater() {
  const router = useRouter();
  const pathname = usePathname();
  const sp = useSearchParams();
  return (mutate: (next: URLSearchParams) => void) => {
    const next = new URLSearchParams(sp.toString());
    mutate(next);
    next.delete("page");
    const qs = next.toString();
    router.push(qs ? `${pathname}?${qs}` : pathname);
  };
}

export function SearchInput({
  paramKey = "q",
  placeholder = "Cerca…",
}: {
  paramKey?: string;
  placeholder?: string;
}) {
  const sp = useSearchParams();
  const update = useUrlUpdater();
  const [value, setValue] = useState(sp.get(paramKey) ?? "");

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        update((n) => (value ? n.set(paramKey, value) : n.delete(paramKey)));
      }}
    >
      <input
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder={placeholder}
        className="w-56 rounded border border-neutral-300 px-3 py-1.5 text-sm outline-none focus:border-neutral-900"
      />
    </form>
  );
}

export function SelectFilter({
  paramKey,
  label,
  options,
}: {
  paramKey: string;
  label: string;
  options: Array<{ value: string; label: string }>;
}) {
  const sp = useSearchParams();
  const update = useUrlUpdater();
  const current = sp.get(paramKey) ?? "";

  return (
    <select
      aria-label={label}
      value={current}
      onChange={(e) =>
        update((n) => (e.target.value ? n.set(paramKey, e.target.value) : n.delete(paramKey)))
      }
      className="rounded border border-neutral-300 px-2 py-1.5 text-sm text-neutral-700"
    >
      <option value="">{label}: tutti</option>
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  );
}

export function ResetFilters({ keys }: { keys: string[] }) {
  const sp = useSearchParams();
  const update = useUrlUpdater();
  const active = keys.some((k) => sp.get(k));
  if (!active) return null;
  return (
    <button
      type="button"
      onClick={() =>
        update((n) => {
          for (const k of keys) n.delete(k);
        })
      }
      className="text-xs text-neutral-500 underline hover:text-neutral-800"
    >
      azzera filtri
    </button>
  );
}
