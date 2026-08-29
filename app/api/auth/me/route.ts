import { currentUser } from "@/lib/auth";
import { error } from "@/lib/api";

export async function GET() {
  const user = await currentUser();
  return user ? Response.json({ user }) : error("Authentication required.", 401);
}
