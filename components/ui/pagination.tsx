import Link from "next/link";

export function Pagination({
  page,
  totalPages,
  hrefFor,
  total,
}: {
  page: number;
  totalPages: number;
  hrefFor: (page: number) => string;
  total?: number;
}) {
  return (
    <div className="flex items-center gap-3 text-xs text-neutral-500">
      {total != null && <span>{total} risultati ·</span>}
      {page > 1 ? (
        <Link href={hrefFor(page - 1)} className="text-blue-700 hover:underline">
          ← precedente
        </Link>
      ) : (
        <span className="text-neutral-300">← precedente</span>
      )}
      <span>
        pagina {page}/{Math.max(1, totalPages)}
      </span>
      {page < totalPages ? (
        <Link href={hrefFor(page + 1)} className="text-blue-700 hover:underline">
          successiva →
        </Link>
      ) : (
        <span className="text-neutral-300">successiva →</span>
      )}
    </div>
  );
}
