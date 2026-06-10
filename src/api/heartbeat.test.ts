import { describe, it, expect, vi } from "vitest";
import { handleHeartbeat } from "./heartbeat";
import type { Logger } from "@/observability/logger";
import type { HeartbeatAutoSuspend } from "@/domain/heartbeat-auto-suspend";

function makeLogger(): Logger {
  return {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  };
}

function makeAutoSuspend(): HeartbeatAutoSuspend {
  return {
    recordHeartbeat: vi.fn(),
    removeHeartbeat: vi.fn(),
    start: vi.fn(),
    stop: vi.fn(),
    checkAll: vi.fn().mockResolvedValue(undefined),
    reset: vi.fn(),
  };
}

describe("handleHeartbeat", () => {
  it("returns 200 and records heartbeat for a valid examAttemptId", async () => {
    const autoSuspend = makeAutoSuspend();
    const result = await handleHeartbeat(
      { autoSuspend, logger: makeLogger() },
      { body: { examAttemptId: "attempt-123" } },
    );
    expect(result.status).toBe(200);
    expect(result.body).toMatchObject({ status: "ok" });
    expect(autoSuspend.recordHeartbeat).toHaveBeenCalledWith("attempt-123");
  });

  it("returns 400 when examAttemptId is missing", async () => {
    const autoSuspend = makeAutoSuspend();
    const result = await handleHeartbeat(
      { autoSuspend, logger: makeLogger() },
      { body: {} },
    );
    expect(result.status).toBe(400);
    expect(result.body).toMatchObject({ error: expect.any(String) });
    expect(autoSuspend.recordHeartbeat).not.toHaveBeenCalled();
  });

  it("returns 400 when body is not an object", async () => {
    const autoSuspend = makeAutoSuspend();
    const result = await handleHeartbeat(
      { autoSuspend, logger: makeLogger() },
      { body: null },
    );
    expect(result.status).toBe(400);
    expect(autoSuspend.recordHeartbeat).not.toHaveBeenCalled();
  });

  it("returns 400 when examAttemptId is an empty string", async () => {
    const autoSuspend = makeAutoSuspend();
    const result = await handleHeartbeat(
      { autoSuspend, logger: makeLogger() },
      { body: { examAttemptId: "  " } },
    );
    expect(result.status).toBe(400);
    expect(autoSuspend.recordHeartbeat).not.toHaveBeenCalled();
  });
});
