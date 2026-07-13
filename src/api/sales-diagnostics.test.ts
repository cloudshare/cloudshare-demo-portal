import { describe, expect, it, vi } from "vitest";
import { handleGetSalesDiagnosticLog } from "./sales-diagnostics";

describe("Sales diagnostics handler", () => {
  it("forces the local Sales source even when a caller supplies a different source", async () => {
    const diagnostics = { append: vi.fn(), query: vi.fn().mockResolvedValue([]) };

    await handleGetSalesDiagnosticLog(
      { diagnostics, logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() } },
      { customerId: "customer-certalis", query: { source: "runtime", operation: "account.created" } },
    );

    expect(diagnostics.query).toHaveBeenCalledWith(expect.objectContaining({
      customerId: "customer-certalis",
      source: "sales-records",
      operation: "account.created",
    }));
  });
});
