import { handler } from "@/lib/api/handler";
import { activatePecTemplate } from "@/services/pec/templates";

export const runtime = "nodejs";

/** Rende attivo il template indicato (usato da compose/invio). */
export const POST = handler<{ id: string }>(
  async ({ params, session }) =>
    Response.json(await activatePecTemplate(params.id, { userId: session?.user.id })),
  { auth: "admin" },
);
