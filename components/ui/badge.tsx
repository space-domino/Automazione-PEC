const COLORS: Record<string, string> = {
  // Domain lifecycle
  DISCOVERED: "bg-neutral-100 text-neutral-600",
  AVAILABLE: "bg-green-100 text-green-800",
  REGISTERED: "bg-neutral-100 text-neutral-500",
  DISCARDED: "bg-neutral-100 text-neutral-400",
  PURCHASE_PENDING: "bg-amber-100 text-amber-800",
  PURCHASED: "bg-blue-100 text-blue-800",
  OFFER_DRAFT: "bg-blue-50 text-blue-700",
  OFFER_PUBLISHED: "bg-indigo-100 text-indigo-800",
  PEC_DRAFT: "bg-amber-50 text-amber-700",
  PEC_APPROVED: "bg-amber-100 text-amber-800",
  PEC_SENT: "bg-purple-100 text-purple-800",
  CUSTOMER_INTERESTED: "bg-purple-50 text-purple-700",
  CHECKOUT_STARTED: "bg-cyan-100 text-cyan-800",
  PAID: "bg-green-100 text-green-800",
  SOLD: "bg-green-200 text-green-900",
  TRANSFER_PENDING: "bg-amber-100 text-amber-800",
  TRANSFERRED: "bg-green-100 text-green-800",
  TRANSFER_FAILED: "bg-red-100 text-red-700",
  REFUNDED: "bg-orange-100 text-orange-800",
  BLOCKED: "bg-red-100 text-red-700",
  // Availability
  UNKNOWN: "bg-neutral-100 text-neutral-500",
  ERROR: "bg-red-100 text-red-700",
  // Job / import
  QUEUED: "bg-neutral-100 text-neutral-600",
  PENDING: "bg-neutral-100 text-neutral-600",
  MAPPING: "bg-amber-100 text-amber-800",
  PROCESSING: "bg-blue-100 text-blue-800",
  ACTIVE: "bg-blue-100 text-blue-800",
  COMPLETED: "bg-green-100 text-green-800",
  PARTIAL: "bg-orange-100 text-orange-800",
  FAILED: "bg-red-100 text-red-700",
  RETRYING: "bg-amber-100 text-amber-800",
  DELAYED: "bg-neutral-100 text-neutral-500",
};

export function Badge({ value, muted }: { value: string; muted?: boolean }) {
  const cls = muted
    ? "bg-neutral-100 text-neutral-500"
    : (COLORS[value] ?? "bg-neutral-100 text-neutral-600");
  return (
    <span
      className={`inline-block whitespace-nowrap rounded px-1.5 py-0.5 text-xs font-medium ${cls}`}
    >
      {value}
    </span>
  );
}
