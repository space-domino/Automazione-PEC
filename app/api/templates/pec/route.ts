import { handler } from "@/lib/api/handler";
import { createPecTemplate, listPecTemplates } from "@/services/pec/templates";
import { z } from "zod";

export const runtime = "nodejs";

/** Raccoglitore: elenco dei template PEC. */
export const GET = handler(async () => Response.json(await listPecTemplates()), {
  auth: "admin",
});

const createSchema = z.object({
  name: z.string().trim().min(1).max(80),
  bodyHtml: z.string().min(1).max(200_000),
  subject: z.string().trim().max(300).default(""),
});

/** Crea un nuovo template nel raccoglitore (non lo attiva). */
export const POST = handler(
  async ({ req, session }) => {
    const input = createSchema.parse(await req.json().catch(() => ({})));
    return Response.json(await createPecTemplate(input, { userId: session?.user.id }), {
      status: 201,
    });
  },
  { auth: "admin" },
);
