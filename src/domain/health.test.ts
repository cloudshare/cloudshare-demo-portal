import { describe, it, expect, vi } from "vitest";
import { checkHealth } from "./health";
import type { HeartbeatRepository, Heartbeat } from "@/persistence/heartbeat-repository";

function fakeRepo(): HeartbeatRepository {
  const store = new Map<string, Heartbeat>();
  return {
    async record(source) {
      const hb = { id: `hb_${store.size + 1}`, source, createdAt: new Date() };
      store.set(hb.id, hb);
      return hb;
    },
    async findById(id) {
      return store.get(id) ?? null;
    },
  };
}

describe("checkHealth", () => {
  it("reports ok, the portal mode, and a persisted-then-read-back heartbeat id", async () => {
    const logger = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };

    const result = await checkHealth({
      mode: "fixture",
      logger,
      heartbeats: fakeRepo(),
    });

    expect(result.status).toBe("ok");
    expect(result.mode).toBe("fixture");
    expect(result.heartbeatId).toBeTruthy();
    // proves the record was read back, not just written
    expect(result.persistenceVerified).toBe(true);
    expect(logger.info).toHaveBeenCalled();
  });
});
