import { describe, it, expect } from "vitest";
import { createInMemoryAuditRepository } from "@/persistence/audit-repository";
import { redactAuditDetails, type AuditRecord } from "./audit-trail";

function makeRecord(partial: Partial<AuditRecord> = {}): AuditRecord {
  return {
    id: "audit-1",
    examAttemptId: "attempt-1",
    action: "lab_launched",
    outcome: "success",
    occurredAt: new Date("2026-01-01T12:00:00Z"),
    ...partial,
  };
}

describe("AuditRepository", () => {
  it("projects protected integration contexts out of ordinary audit details", () => {
    const protectedMarker = "synthetic-protected-marker";
    const projected = redactAuditDetails({
      operation: "candidate_admission",
      integrationSurface: "cloudshare.v4.training.participant",
      status: 502,
      request: {
        query: { marker: protectedMarker },
        headers: { marker: protectedMarker },
        body: { marker: protectedMarker },
      },
      response: {
        headers: { marker: protectedMarker },
        body: { marker: protectedMarker },
      },
      context: { marker: protectedMarker },
      cause: { marker: protectedMarker },
    });

    expect(JSON.stringify(projected).includes(protectedMarker)).toBe(false);
    expect(projected).toMatchObject({
      operation: "candidate_admission",
      integrationSurface: "cloudshare.v4.training.participant",
      status: 502,
    });
  });

  it("writes and retrieves records by examAttemptId", async () => {
    const repo = createInMemoryAuditRepository();
    await repo.write(makeRecord({ examAttemptId: "a-1", id: "r-1" }));
    await repo.write(makeRecord({ examAttemptId: "a-1", id: "r-2", action: "lab_suspended" }));
    await repo.write(makeRecord({ examAttemptId: "a-2", id: "r-3" }));

    const results = await repo.listByExamAttemptId("a-1");
    expect(results).toHaveLength(2);
    expect(results.map((r) => r.id)).toEqual(expect.arrayContaining(["r-1", "r-2"]));
  });

  it("listAll returns every record newest-first", async () => {
    const repo = createInMemoryAuditRepository();
    await repo.write(makeRecord({ id: "r-1", occurredAt: new Date("2026-01-01T10:00:00Z") }));
    await repo.write(makeRecord({ id: "r-2", occurredAt: new Date("2026-01-01T11:00:00Z") }));

    const all = await repo.listAll();
    expect(all).toHaveLength(2);
    expect(all[0].id).toBe("r-2"); // newest first
  });

  it("listAll respects optional limit", async () => {
    const repo = createInMemoryAuditRepository();
    for (let i = 0; i < 5; i++) {
      await repo.write(makeRecord({ id: `r-${i}` }));
    }
    const limited = await repo.listAll(3);
    expect(limited).toHaveLength(3);
  });

  it("listByExamAttemptId returns empty array when no records match", async () => {
    const repo = createInMemoryAuditRepository();
    const results = await repo.listByExamAttemptId("no-such");
    expect(results).toEqual([]);
  });
});
