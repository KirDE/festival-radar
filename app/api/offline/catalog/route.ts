import { serveOfflineCatalog } from "@/lib/catalog/offline";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: Request) {
  return serveOfflineCatalog(request);
}
