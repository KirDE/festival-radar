import { currentUser } from "@/lib/auth";

export async function currentAdmin() {
  const user = await currentUser();
  if (!user) return null;
  if (user.role !== "EDITOR" && user.role !== "ADMIN") return null;
  return user;
}
