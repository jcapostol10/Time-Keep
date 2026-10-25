import { randomUUID } from "node:crypto";

import { describe, expect, it } from "vitest";

import { env } from "./env";
import { deleteExport, presignedExportUrl, uploadExport } from "./storage";

/** Needs the local S3 (RustFS) with both buckets: `pnpm storage:init`. */
describe("the private export bucket", () => {
  it("serves an export only through a presigned URL", async () => {
    const key = `exports/test/${randomUUID()}.csv`;
    await uploadExport({
      key,
      body: new TextEncoder().encode("a,b\r\n1,2\r\n"),
      contentType: "text/csv",
    });
    try {
      const signed = await presignedExportUrl(key, 60, "report.csv");
      const res = await fetch(signed);
      expect(res.status).toBe(200);
      expect(await res.text()).toBe("a,b\r\n1,2\r\n");
      expect(res.headers.get("content-disposition")).toContain("report.csv");

      // No anonymous reads: neither the export bucket's own path nor a guess at the public one.
      const e = env();
      const plain = await fetch(`${e.S3_ENDPOINT.replace(/\/$/, "")}/${e.S3_EXPORT_BUCKET}/${key}`);
      expect(plain.status).toBe(403);
      const publicGuess = await fetch(`${e.S3_PUBLIC_URL.replace(/\/$/, "")}/${key}`);
      expect(publicGuess.ok).toBe(false);
    } finally {
      await deleteExport(key);
    }
    const after = await fetch(await presignedExportUrl(key, 60, "report.csv"));
    expect(after.status).toBe(404);
  });
});
