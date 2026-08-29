import { describe, it, expect } from "vitest";
import { uploadTenantArchive } from "./upload-archive";

const hasBlobToken = Boolean(process.env.BLOB_READ_WRITE_TOKEN);

describe.skipIf(!hasBlobToken)("uploadTenantArchive", () => {
  it("uploads and returns a verified, reachable URL", { timeout: 30000 }, async () => {
    const buffer = Buffer.from("test archive contents");
    const result = await uploadTenantArchive("upload-test-tenant", buffer);

    expect(result.url).toMatch(/^https:\/\//);

    const response = await fetch(result.url);
    expect(response.ok).toBe(true);
    const downloaded = Buffer.from(await response.arrayBuffer());
    expect(downloaded.equals(buffer)).toBe(true);
  });
});
