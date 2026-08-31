import { PrismaClient } from "@prisma/client";
const retentionDays = Number.parseInt(process.env.ANALYTICS_RETENTION_DAYS ?? "90", 10);
if (!Number.isInteger(retentionDays) || retentionDays < 1 || retentionDays > 730) throw new Error("ANALYTICS_RETENTION_DAYS must be an integer from 1 to 730");
const cutoff = new Date();
cutoff.setUTCHours(0, 0, 0, 0);
cutoff.setUTCDate(cutoff.getUTCDate() - retentionDays);
const db = new PrismaClient();
try {
  const result = await db.analyticsDaily.deleteMany({ where: { day: { lt: cutoff } } });
  console.log(JSON.stringify({ deletedAggregateRows: result.count, cutoff: cutoff.toISOString(), retentionDays }));
} finally { await db.$disconnect(); }
