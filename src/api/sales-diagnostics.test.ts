import { describe, expect, it, vi } from "vitest";
import { handleGetSalesDiagnosticLog } from "./sales-diagnostics";

describe("Sales diagnostics handler", () => {
  it("keeps the authenticated Customer scope while allowing an owned Demo Item source", async () => {
    const diagnostics = { append: vi.fn(), query: vi.fn().mockResolvedValue([]) };

    await handleGetSalesDiagnosticLog(
      { diagnostics, logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() } },
      { customerId: "customer-certalis", query: { source: "sales-demo-items", operation: "demo_item.resource_read" } },
    );

    expect(diagnostics.query).toHaveBeenCalledWith(expect.objectContaining({
      customerId: "customer-certalis",
      source: "sales-demo-items",
      operation: "demo_item.resource_read",
    }));
  });

  it("combines Sales record and Demo Item evidence when no source is selected", async () => {
    const diagnostics = { append: vi.fn(), query: vi.fn().mockResolvedValue([]) };

    await handleGetSalesDiagnosticLog(
      { diagnostics, logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() } },
      { customerId: "customer-certalis", query: {} },
    );

    expect(diagnostics.query).toHaveBeenCalledWith(expect.objectContaining({ customerId: "customer-certalis", source: "sales-records" }));
    expect(diagnostics.query).toHaveBeenCalledWith(expect.objectContaining({ customerId: "customer-certalis", source: "sales-demo-items" }));
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
});
