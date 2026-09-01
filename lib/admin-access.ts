import type { UserRole } from "@prisma/client";
import { currentUser } from "@/lib/auth";
import { ADMIN_ROLES, roleAllowed } from "@/lib/admin-auth";

export async function currentAdmin(allowedRoles: readonly UserRole[] = ADMIN_ROLES) {
  const user = await currentUser();
  if (!user) return null;
  if (!roleAllowed(user.role, allowedRoles)) return null;
  const allowed = (process.env.ADMIN_EMAILS ?? "").split(",").map((value) => value.trim().toLowerCase()).filter(Boolean);
  if (!allowed.includes(user.email.toLowerCase())) return null;
  return user;
}
