// Stato = pallino + parola, mai colore da solo. Tre famiglie semantiche + neutro.
type Tone = "neutral" | "ok" | "warn" | "danger" | "active" | "flight";

const TONE: Record<Tone, string> = {
  neutral: "bg-neutral-100 text-neutral-600",
  ok: "bg-[#e6f4ec] text-[#157a4a]",
  warn: "bg-[#fbf1dc] text-[#9a6700]",
  danger: "bg-[#fbe9e7] text-[#b3261e]",
  active: "bg-[var(--accent-soft)] text-[var(--accent)]",
  flight: "bg-[#f0ecfb] text-[#6a4bd0]",
};

const MAP: Record<string, Tone> = {
  // Domain
  DISCOVERED: "neutral",
  AVAILABLE: "ok",
  REGISTERED: "neutral",
  DISCARDED: "neutral",
  PURCHASE_PENDING: "warn",
  PURCHASED: "active",
  OFFER_DRAFT: "warn",
  OFFER_PUBLISHED: "active",
  PEC_DRAFT: "warn",
  PEC_APPROVED: "warn",
  PEC_SENT: "flight",
  CUSTOMER_INTERESTED: "flight",
  CHECKOUT_STARTED: "flight",
  PAID: "ok",
  SOLD: "ok",
  TRANSFER_PENDING: "warn",
  TRANSFERRED: "ok",
  TRANSFER_FAILED: "danger",
  REFUNDED: "warn",
  BLOCKED: "danger",
  // Availability
  UNKNOWN: "neutral",
  ERROR: "danger",
  // Offer
  DRAFT: "warn",
  PUBLISHED: "active",
  PAUSED: "neutral",
  WITHDRAWN: "neutral",
  // Communication
  APPROVED: "warn",
  QUEUED: "neutral",
  SENDING: "flight",
  SENT: "flight",
  ACCEPTED: "flight",
  DELIVERED: "ok",
  BOUNCED: "danger",
  CANCELLED: "neutral",
  // Order
  FULFILLMENT_PENDING: "warn",
  COMPLETED: "ok",
  // Payment
  PROCESSING: "flight",
  SUCCEEDED: "ok",
  // Job / import
  PENDING: "neutral",
  MAPPING: "warn",
  ACTIVE: "flight",
  PARTIAL: "warn",
  FAILED: "danger",
  RETRYING: "warn",
  DELAYED: "neutral",
  // Severity
  INFO: "neutral",
  WARN: "warn",
  // Campaign (stato campagna, maiuscolo) e riga campagna (minuscolo, spazio distinto)
  MATCHED: "warn",
  DONE: "ok",
  pending: "neutral",
  conflict: "danger",
  sent: "ok",
  failed: "danger",
  skipped: "neutral",
};

export function Badge({ value, muted }: { value: string | null | undefined; muted?: boolean }) {
  if (!value) return <span className="text-[var(--ink-faint)]">–</span>;
  const tone: Tone = muted ? "neutral" : (MAP[value] ?? "neutral");
  return <span className={`chip ${TONE[tone]}`}>{value}</span>;
}
