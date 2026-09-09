import { handler } from "@/lib/api/handler";
import { composePecDraft, previewPec } from "@/services/pec";
import { z } from "zod";

export const runtime = "nodejs";

const bodySchema = z.object({
  templateName: z.string().trim().min(1).optional(),
  bodyHtmlOverride: z.string().min(1).max(50_000).optional(),
  sellerLegalName: z.string().trim().max(200).optional(),
  sellerContact: z.string().trim().max(200).optional(),
  preview: z.boolean().optional(),
});

export const POST = handler<{ id: string }>(
  async ({ params, req, session, requestId }) => {
    const { preview, ...opts } = bodySchema.parse(await req.json().catch(() => ({})));
    if (preview) return Response.json(await previewPec(params.id, opts));
    return Response.json(
      await composePecDraft(params.id, opts, { userId: session?.user.id, requestId }),
      { status: 201 },
    );
  },
  { auth: "admin" },
);

export const GET = handler<{ id: string }>(
  async ({ params }) => Response.json(await previewPec(params.id)),
  { auth: "admin" },
);
