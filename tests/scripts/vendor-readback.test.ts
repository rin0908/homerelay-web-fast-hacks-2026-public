import { describe, expect, it, vi } from "vitest";

import {
  readVendorJson,
  TransientVendorReadbackError,
} from "../e2e/vendor-readback";

describe("hosted vendor read-back response handling", () => {
  it("classifies response body read failures as transient without exposing details", async () => {
    const privateDetail = "private vendor response detail";

    await expect(
      readVendorJson(
        { json: vi.fn().mockRejectedValue(new Error(privateDetail)) },
        "qdrant_response_read_failed",
      ),
    ).rejects.toMatchObject({
      message:
        "Hosted E2E transient read-back failure: qdrant_response_read_failed",
      name: "TransientVendorReadbackError",
    });

    const neo4jError = await readVendorJson(
      { json: vi.fn().mockRejectedValue(new Error(privateDetail)) },
      "neo4j_response_read_failed",
    ).catch((error: unknown) => error);

    expect(neo4jError).toBeInstanceOf(TransientVendorReadbackError);
    expect(String(neo4jError)).toContain("neo4j_response_read_failed");
    expect(String(neo4jError)).not.toContain(privateDetail);
  });

  it("returns parsed malformed shapes unchanged for permanent caller validation", async () => {
    const malformedShape = { unexpected: true };

    await expect(
      readVendorJson(
        { json: vi.fn().mockResolvedValue(malformedShape) },
        "qdrant_response_read_failed",
      ),
    ).resolves.toBe(malformedShape);
  });
});
