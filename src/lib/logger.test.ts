import { describe, it, expect } from "vitest";
import { Writable } from "node:stream";
import { createLogger } from "./logger";

describe("createLogger", () => {
  it("includes tenantId in every log line", async () => {
    const lines: string[] = [];
    const stream = new Writable({
      write(chunk, _enc, callback) {
        lines.push(chunk.toString());
        callback();
      },
    });

    const logger = createLogger("tenant-123", stream);
    logger.info("test message");

    expect(lines[0]).toContain('"tenantId":"tenant-123"');
    expect(lines[0]).toContain('"msg":"test message"');
  });
});
