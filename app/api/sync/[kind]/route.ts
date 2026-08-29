import { Prisma, SyncKind } from "@prisma/client";
import { z } from "zod";
import { db } from "@/lib/db";
import { error, requireUser } from "@/lib/api";

const kinds: Record<string, SyncKind> = {
  favorites: SyncKind.FAVORITES, collections: SyncKind.COLLECTIONS,
  "saved-filters": SyncKind.SAVED_FILTERS, plans: SyncKind.FESTIVAL_PLANS,
};
const input = z.object({ payload: z.json().refine((value) => value !== null), revision: z.number().int().nonnegative() });

export async function GET(_: Request, context: { params: Promise<{ kind: string }> }) {
  const user = await requireUser();
  if (!user) return error("Authentication required.", 401);
  const kind = kinds[(await context.params).kind];
  if (!kind) return error("Unknown sync document.", 404);
  const document = await db.syncDocument.findUnique({ where: { userId_kind: { userId: user.id, kind } } });
  return Response.json({ document });
}

export async function PUT(request: Request, context: { params: Promise<{ kind: string }> }) {
  const user = await requireUser();
  if (!user) return error("Authentication required.", 401);
  const kind = kinds[(await context.params).kind];
  if (!kind) return error("Unknown sync document.", 404);
  const parsed = input.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return error("Payload and revision are required.");
  const existing = await db.syncDocument.findUnique({ where: { userId_kind: { userId: user.id, kind } } });
  if (!existing) {
    if (parsed.data.revision !== 0) return error("Sync conflict. Fetch the latest document.", 409);
    const document = await db.syncDocument.create({ data: { userId: user.id, kind, payload: parsed.data.payload as Prisma.InputJsonValue } });
    return Response.json({ document }, { status: 201 });
  }
  const updated = await db.syncDocument.updateMany({
    where: { id: existing.id, revision: parsed.data.revision },
    data: { payload: parsed.data.payload as Prisma.InputJsonValue, revision: { increment: 1 } },
  });
  if (!updated.count) return error("Sync conflict. Fetch the latest document.", 409);
  return Response.json({ document: await db.syncDocument.findUniqueOrThrow({ where: { id: existing.id } }) });
}
