import { handler } from "@/lib/api/handler";
import { getActivePecTemplate, saveActivePecTemplate } from "@/services/pec/templates";
import { z } from "zod";

export const runtime = "nodejs";

export const GET = handler(async () => Response.json(await getActivePecTemplate()), {
  auth: "admin",
});

const saveSchema = z.object({
  bodyHtml: z.string().min(1).max(200_000),
  subject: z.string().trim().max(300).optional(),
});

export const PUT = handler(
  async ({ req, session }) => {
    const input = saveSchema.parse(await req.json().catch(() => ({})));
    return Response.json(await saveActivePecTemplate(input, { userId: session?.user.id }));
  },
  { auth: "admin" },
);
