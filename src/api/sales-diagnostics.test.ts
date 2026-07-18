import { describe, expect, it, vi } from "vitest";
import { createInMemoryDiagnosticLogRepository } from "@/persistence/diagnostic-log-repository";
import { handleGetSalesDiagnosticLog } from "./sales-diagnostics";

describe("Sales diagnostics handler", () => {
  it("keeps the authenticated Customer scope while allowing an owned Item source", async () => {
    const diagnostics = { append: vi.fn(), query: vi.fn().mockResolvedValue([]) };

    await handleGetSalesDiagnosticLog(
      { diagnostics, logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() } },
      { customerId: "customer-certalis", query: { source: "sales-items", operation: "item.resource_read" } },
    );

    expect(diagnostics.query).toHaveBeenCalledWith(expect.objectContaining({
      customerId: "customer-certalis",
      source: "sales-items",
      operation: "item.resource_read",
    }));
  });

  it("allows Sales Enablement Session diagnostics to be correlated from Sales Support", async () => {
    const diagnostics = { append: vi.fn(), query: vi.fn().mockResolvedValue([]) };
    await handleGetSalesDiagnosticLog({ diagnostics, logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() } }, { customerId: "customer-certalis", query: { source: "sales-demo-sessions", correlationId: "corr-1" } });
    expect(diagnostics.query).toHaveBeenCalledWith(expect.objectContaining({ customerId: "customer-certalis", source: "sales-demo-sessions", correlationId: "corr-1" }));
  });

  it("allows Project-member lookup failures to be correlated from Sales Support", async () => {
    const diagnostics = { append: vi.fn(), query: vi.fn().mockResolvedValue([]) };
    await handleGetSalesDiagnosticLog({ diagnostics, logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() } }, { customerId: "customer-certalis", query: { source: "sales-project-members", correlationId: "corr-members-failed" } });
    expect(diagnostics.query).toHaveBeenCalledWith(expect.objectContaining({ customerId: "customer-certalis", source: "sales-project-members", correlationId: "corr-members-failed" }));
  });

  it("allows participant reconciliation evidence to be correlated from Sales Support", async () => {
    const diagnostics = { append: vi.fn(), query: vi.fn().mockResolvedValue([]) };
    await handleGetSalesDiagnosticLog({ diagnostics, logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() } }, { customerId: "customer-certalis", query: { source: "sales-session-participants", correlationId: "corr-participants-failed" } });
    expect(diagnostics.query).toHaveBeenCalledWith(expect.objectContaining({ customerId: "customer-certalis", source: "sales-session-participants", correlationId: "corr-participants-failed" }));
  });

  it("returns correlated participant reconciliation evidence through the aggregate Sales Support feed", async () => {
    const diagnostics = createInMemoryDiagnosticLogRepository();
    await diagnostics.append({ source: "sales-session-participants", operation: "sales.demo_session.participants.reconciled", outcome: "failure", customerId: "customer-certalis", correlationId: "corr-participants-failed", message: "CloudShare could not reconcile Sales Participant monitoring", occurredAt: new Date("2026-07-17T00:00:00.000Z") });

    const response = await handleGetSalesDiagnosticLog(
      { diagnostics, logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() } },
      { customerId: "customer-certalis", query: { correlationId: "corr-participants-failed" } },
    );

    expect(response).toMatchObject({ status: 200, body: { entries: [expect.objectContaining({ source: "sales-session-participants", correlationId: "corr-participants-failed", outcome: "failure" })] } });
  });

  it("returns a correlated Project-member lookup failure through the aggregate Sales Support feed", async () => {
    const diagnostics = createInMemoryDiagnosticLogRepository();
    await diagnostics.append({ source: "sales-project-members", operation: "sales.enablement_session.project_members.read", outcome: "failure", customerId: "customer-certalis", correlationId: "corr-members-failed", message: "CloudShare could not read active Project members", occurredAt: new Date("2026-07-15T00:00:00.000Z") });
    const response = await handleGetSalesDiagnosticLog({ diagnostics, logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() } }, { customerId: "customer-certalis", query: { correlationId: "corr-members-failed" } });
    expect(response).toMatchObject({ status: 200, body: { entries: [expect.objectContaining({ source: "sales-project-members", correlationId: "corr-members-failed", outcome: "failure" })] } });
  });

  it("returns a correlated CloudShare status verification through the aggregate Sales Support feed", async () => {
    const diagnostics = createInMemoryDiagnosticLogRepository();
    await diagnostics.append({ source: "sales-session-reconciliation", operation: "sales.enablement_session.status.read", outcome: "success", customerId: "customer-certalis", correlationId: "corr-verified-1", message: "CloudShare Sales Experience status verified", occurredAt: new Date("2026-07-17T00:00:00.000Z") });

    const response = await handleGetSalesDiagnosticLog(
      { diagnostics, logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() } },
      { customerId: "customer-certalis", query: { correlationId: "corr-verified-1" } },
    );

    expect(response).toMatchObject({ status: 200, body: { entries: [expect.objectContaining({ source: "sales-session-reconciliation", correlationId: "corr-verified-1", outcome: "success" })] } });
  });

  it("combines Sales record and Item evidence when no source is selected", async () => {
    const diagnostics = { append: vi.fn(), query: vi.fn().mockResolvedValue([]) };

    await handleGetSalesDiagnosticLog(
      { diagnostics, logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() } },
      { customerId: "customer-certalis", query: {} },
    );

    expect(diagnostics.query).toHaveBeenCalledWith(expect.objectContaining({ customerId: "customer-certalis", source: "sales-records" }));
    expect(diagnostics.query).toHaveBeenCalledWith(expect.objectContaining({ customerId: "customer-certalis", source: "sales-items" }));
    expect(diagnostics.query).toHaveBeenCalledWith(expect.objectContaining({ customerId: "customer-certalis", source: "sales-session-reconciliation" }));
    expect(diagnostics.query).toHaveBeenCalledWith(expect.objectContaining({ customerId: "customer-certalis", source: "sales-project-members" }));
    expect(diagnostics.query).toHaveBeenCalledWith(expect.objectContaining({ customerId: "customer-certalis", source: "sales-session-participants" }));
  });

  it("rejects an arbitrary source instead of widening Sales support", async () => {
    const diagnostics = { append: vi.fn(), query: vi.fn().mockResolvedValue([]) };

    const response = await handleGetSalesDiagnosticLog(
      { diagnostics, logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() } },
      { customerId: "customer-certalis", query: { source: "runtime" } },
    );

    expect(response).toEqual({ status: 400, body: { error: "unsupported_sales_diagnostic_source" } });
    expect(diagnostics.query).not.toHaveBeenCalled();
  });

  it("rejects an aggregate offset beyond the safe read window before querying diagnostics", async () => {
    const diagnostics = { append: vi.fn(), query: vi.fn().mockResolvedValue([]) };

    const response = await handleGetSalesDiagnosticLog(
      { diagnostics, logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() } },
      { customerId: "customer-certalis", query: { offset: "5001", limit: "100" } },
    );

    expect(response).toEqual({
      status: 400,
      body: { error: "sales_diagnostic_offset_exceeds_maximum", maxOffset: 5000 },
    });
    expect(diagnostics.query).not.toHaveBeenCalled();
  });

  it("reaches older globally ordered entries beyond 500 per source with a sound next page", async () => {
    const diagnostics = createInMemoryDiagnosticLogRepository();
    const base = Date.UTC(2026, 6, 13, 12, 0, 0);
    for (let index = 0; index < 600; index += 1) {
      await diagnostics.append({ source: "sales-records", operation: "account.updated", outcome: "success", customerId: "customer-certalis", message: `record-${index}`, occurredAt: new Date(base + index * 2_000) });
    }
    for (let index = 0; index < 600; index += 1) {
      await diagnostics.append({ source: "sales-items", operation: "item.resource_read", outcome: "success", customerId: "customer-certalis", message: `item-${index}`, occurredAt: new Date(base + index * 2_000 + 1_000) });
    }

    const response = await handleGetSalesDiagnosticLog(
      { diagnostics, logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() } },
      { customerId: "customer-certalis", query: { offset: "550", limit: "3" } },
    );

    expect(response).toMatchObject({
      status: 200,
      body: {
        entries: [{ id: "diag-925" }, { id: "diag-325" }, { id: "diag-924" }],
        page: { limit: 3, offset: 550, returned: 3, hasMore: true, nextOffset: 553 },
      },
    });
  });

  it("clamps an invalid zero limit so aggregate pagination can advance", async () => {
    const diagnostics = createInMemoryDiagnosticLogRepository();
    await diagnostics.append({ source: "sales-records", operation: "account.updated", outcome: "success", customerId: "customer-certalis", message: "one" });

    const response = await handleGetSalesDiagnosticLog(
      { diagnostics, logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() } },
      { customerId: "customer-certalis", query: { limit: "0" } },
    );

    expect(response).toMatchObject({ status: 200, body: { page: { limit: 100, returned: 1, hasMore: false, nextOffset: null } } });
  });
});
