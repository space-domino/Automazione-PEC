import { handler } from "@/lib/api/handler";
import { deletePecTemplate, getPecTemplate, updatePecTemplate } from "@/services/pec/templates";
import { z } from "zod";

export const runtime = "nodejs";

export const GET = handler<{ id: string }>(
  async ({ params }) => {
    const t = await getPecTemplate(params.id);
    return t ? Response.json(t) : new Response("not found", { status: 404 });
  },
  { auth: "admin" },
);

const patchSchema = z
  .object({
    name: z.string().trim().min(1).max(80).optional(),
    bodyHtml: z.string().min(1).max(200_000).optional(),
    subject: z.string().trim().max(300).optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: "Niente da aggiornare" });

export const PUT = handler<{ id: string }>(
  async ({ req, params, session }) => {
    const input = patchSchema.parse(await req.json().catch(() => ({})));
    return Response.json(await updatePecTemplate(params.id, input, { userId: session?.user.id }));
  },
  { auth: "admin" },
);

export const DELETE = handler<{ id: string }>(
  async ({ params, session }) => {
    await deletePecTemplate(params.id, { userId: session?.user.id });
    return new Response(null, { status: 204 });
  },
  { auth: "admin" },
);
