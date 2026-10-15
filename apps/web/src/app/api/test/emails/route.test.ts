import { describe, expect, it } from "vitest";

import { GET } from "./route";

describe("GET /api/test/emails", () => {
  it("is a 404 when mail capture is not enabled, even with a secret header", async () => {
    const response = await GET(
      new Request("http://localhost/api/test/emails?to=a@e2e.test", {
        headers: { "x-e2e-secret": "anything-at-all-123456" },
      }),
    );
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: "Not found" });
  });
});
