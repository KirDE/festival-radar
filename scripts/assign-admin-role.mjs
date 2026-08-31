import { PrismaClient } from "@prisma/client";

const [emailArg, roleArg, confirmation] = process.argv.slice(2);
const email = emailArg?.trim().toLowerCase();
const role = roleArg?.toUpperCase();
if (!email || !["USER", "EDITOR", "ADMIN"].includes(role) || confirmation !== "--confirm") {
  console.error("Usage: npm run admin:assign-role -- user@example.com USER|EDITOR|ADMIN --confirm");
  process.exit(2);
}
const db = new PrismaClient();
try {
  const user = await db.user.update({ where: { email }, data: { role }, select: { id: true, email: true, role: true } });
  console.log(`Role updated for ${user.email}: ${user.role}`);
} finally { await db.$disconnect(); }
