import { handler } from "@/lib/api/handler";
import { pecHealth } from "@/services/pec";

export const runtime = "nodejs";

/** Diagnostica: login SMTP + apertura IMAP. Non invia nulla. */
export const GET = handler(async () => Response.json(await pecHealth()), { auth: "admin" });
