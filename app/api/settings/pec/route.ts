import { handler } from "@/lib/api/handler";
import { db } from "@/lib/db";
import { getSetting, setSetting } from "@/lib/settings";
import { z } from "zod";

export const runtime = "nodejs";

export const GET = handler(
  async () =>
    Response.json({
      autoCompose: await getSetting("pec.auto_compose"),
      autoSend: await getSetting("pec.auto_send"),
    }),
  { auth: "admin" },
);

const patchSchema = z
  .object({
    autoCompose: z.boolean().optional(),
    autoSend: z.boolean().optional(),
  })
  .refine((v) => v.autoCompose !== undefined || v.autoSend !== undefined, {
    message: "Nessuna impostazione da aggiornare",
  });

export const PUT = handler(
  async ({ req, session }) => {
    const input = patchSchema.parse(await req.json().catch(() => ({})));

    if (input.autoCompose !== undefined) {
      await setSetting("pec.auto_compose", input.autoCompose);
    }
    if (input.autoSend !== undefined) {
      await setSetting("pec.auto_send", input.autoSend);
    }

    await db.auditLog.create({
      data: {
        action: "pec.settings.update",
        entityType: "Setting",
        entityId: "pec",
        actorType: "USER",
        actorUserId: session?.user.id ?? null,
        summary: `PEC: ${[
          input.autoCompose !== undefined && `auto_compose=${input.autoCompose}`,
          input.autoSend !== undefined && `auto_send=${input.autoSend}`,
        ]
          .filter(Boolean)
          .join(" ")}`,
      },
    });

    return Response.json({
      autoCompose: await getSetting("pec.auto_compose"),
      autoSend: await getSetting("pec.auto_send"),
    });
  },
  { auth: "admin" },
);
