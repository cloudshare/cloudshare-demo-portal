import { describe, it, expect, vi } from "vitest";
import { createLogger } from "./logger";

describe("createLogger", () => {
  it("emits a structured JSON line with level, message and fields", () => {
    const sink = vi.fn();
    const logger = createLogger({ secrets: [], sink });

    logger.info("lab launched", { examAttemptId: "ea_1" });

    expect(sink).toHaveBeenCalledOnce();
    const line = JSON.parse(sink.mock.calls[0][0] as string);
    expect(line.level).toBe("info");
    expect(line.message).toBe("lab launched");
    expect(line.examAttemptId).toBe("ea_1");
  });

  it("redacts known secret values wherever they appear in fields", () => {
    const sink = vi.fn();
    const logger = createLogger({ secrets: ["super-secret-token"], sink });

    logger.error("call failed", { authHeader: "Bearer super-secret-token" });

    const line = JSON.parse(sink.mock.calls[0][0] as string);
    expect(line.authHeader).not.toContain("super-secret-token");
    expect(line.authHeader).toContain("[REDACTED]");
  });

  it("never lets a raw secret reach the sink even as a bare field value", () => {
    const sink = vi.fn();
    const logger = createLogger({ secrets: ["whsecret"], sink });

    logger.info("verifying", { secret: "whsecret" });

    const raw = sink.mock.calls[0][0] as string;
    expect(raw).not.toContain("whsecret");
  });
});
