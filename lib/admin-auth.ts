import type { UserRole } from "@prisma/client";
import { currentUser } from "@/lib/auth";
import { error } from "@/lib/api";

export type AdminActor = { id: string; email: string; role: UserRole };
export const ADMIN_ROLES: readonly UserRole[] = ["EDITOR", "ADMIN"];

export function roleAllowed(role: UserRole, allowed: readonly UserRole[] = ADMIN_ROLES) {
  return allowed.includes(role);
}

export function accessStatus(role: UserRole | null, allowed: readonly UserRole[] = ADMIN_ROLES) {
  if (!role) return 401;
  return roleAllowed(role, allowed) ? 200 : 403;
}

export async function requireAdminActor(allowed: readonly UserRole[] = ADMIN_ROLES): Promise<
  { response: Response; actor: null } | { response: null; actor: AdminActor }
> {
  const actor = await currentUser();
  const status = accessStatus(actor?.role ?? null, allowed);
  if (status === 401) return { response: error("Authentication required.", 401), actor: null };
  if (status === 403) return { response: error("Administrator role required.", 403), actor: null };
  return { response: null, actor: actor as AdminActor };
}

export function requestHasTrustedOrigin(request: Request, configuredAppUrl = process.env.APP_URL) {
  const origin = request.headers.get("origin");
  if (!origin) return false;
  const expected = configuredAppUrl ? new URL(configuredAppUrl).origin : new URL(request.url).origin;
  return origin === expected;
}

export function rejectUntrustedOrigin(request: Request) {
  return requestHasTrustedOrigin(request) ? null : error("Untrusted request origin.", 403);
}
