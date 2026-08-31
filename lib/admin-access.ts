import { currentUser } from "@/lib/auth";

export async function currentAdmin() {
  const user = await currentUser();
  if (!user) return null;
  const allowed = (process.env.ADMIN_EMAILS ?? "").split(",").map((value) => value.trim().toLowerCase()).filter(Boolean);
  if (!allowed.includes(user.email.toLowerCase())) return null;
  return user;
}
