import { notFound } from "next/navigation";
import { SharedPlanContent } from "@/components/PublicCatalogPages";
import { db } from "@/lib/db";
export const dynamic = "force-dynamic";
export default async function SharedPlan({ params }: { params: Promise<{ slug: string }> }) {
  const link = await db.shareLink.findUnique({ where: { slug: (await params).slug }, include: { document: true } });
  if (!link || (link.expiresAt && link.expiresAt <= new Date())) notFound();
  const payload = link.document.payload as { attendance?: Record<string, string> };
  return <SharedPlanContent attendance={payload.attendance || {}} updatedAt={link.document.updatedAt.toISOString()} />;
}
