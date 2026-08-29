import { randomBytes } from "node:crypto";
import { z } from "zod";
import { db } from "@/lib/db";
import { error, requireUser } from "@/lib/api";

const input = z.object({ documentId: z.string().min(1), expiresAt: z.iso.datetime().nullable().optional() });

export async function POST(request: Request) {
  const user = await requireUser();
  if (!user) return error("Authentication required.", 401);
  const parsed = input.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return error("A document ID is required.");
  const document = await db.syncDocument.findFirst({ where: { id: parsed.data.documentId, userId: user.id } });
  if (!document) return error("Document not found.", 404);
  const link = await db.shareLink.upsert({
    where: { documentId: document.id },
    create: { documentId: document.id, userId: user.id, slug: randomBytes(18).toString("base64url"), expiresAt: parsed.data.expiresAt ? new Date(parsed.data.expiresAt) : null },
    update: { expiresAt: parsed.data.expiresAt ? new Date(parsed.data.expiresAt) : null },
  });
  return Response.json({ share: { slug: link.slug, expiresAt: link.expiresAt } }, { status: 201 });
}
