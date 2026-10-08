import assert from "node:assert/strict";
import test from "node:test";

// Disabled before origin, cookies, Prisma reads or transport. No host access.
test("Nova raw capture route is dormant by default", async () => {
  const previous = process.env.NOVA_ROCK_RAW_CAPTURE_ENABLED;
  delete process.env.NOVA_ROCK_RAW_CAPTURE_ENABLED;
  try {
    const { POST } = await import("../app/api/admin/novarock/raw-capture/route.ts");
    const response = await POST(new Request("http://127.0.0.1:32779/api/admin/novarock/raw-capture", { method: "POST" }));
    assert.equal(response.status, 404);
    assert.deepEqual(await response.json(), { authority: "NONE", error: "Capture unavailable." });
  } finally {
    if (previous === undefined) delete process.env.NOVA_ROCK_RAW_CAPTURE_ENABLED;
    else process.env.NOVA_ROCK_RAW_CAPTURE_ENABLED = previous;
  }
});
