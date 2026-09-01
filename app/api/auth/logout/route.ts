import { destroySession } from "@/lib/auth";
import { rejectUntrustedOrigin } from "@/lib/request-origin";

export async function POST(request: Request) {
  const originError = rejectUntrustedOrigin(request);
  if (originError) return originError;
  await destroySession();
  return new Response(null, { status: 204 });
}
