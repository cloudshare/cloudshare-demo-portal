import { describe, expect, it, vi } from "vitest";
import { createInMemoryDiagnosticLogRepository } from "@/persistence/diagnostic-log-repository";
import { handleGetSalesDiagnosticLog } from "./sales-diagnostics";
import type { SalesTrialEnrollmentRepository } from "@/domain/sales-trial-enrollment";

describe("Sales diagnostics handler", () => {
  const enrollmentRepo = (offeringId = "offering-1"): Pick<SalesTrialEnrollmentRepository, "findById"> & { findById: NonNullable<SalesTrialEnrollmentRepository["findById"]> } => ({ findById: vi.fn().mockResolvedValue({ salesTrialOfferingId: offeringId }) });
  it("orders complete workflow groups by newest anchor and places contributing semantics between exchanges", async () => {
    const diagnostics = createInMemoryDiagnosticLogRepository();
    const add = (correlationId: string, id: string, occurredAt: string, details: Record<string, unknown>) => diagnostics.append({ source: "sales-records", operation: "x", outcome: "success", customerId: "customer-certalis", correlationId, id, occurredAt: new Date(occurredAt), details, message: id } as never);
    await add("workflow-a", "a-1", "2026-09-10T00:00:01.000Z", { exchangeId: "a-ex-1", attemptStartSequence: 1 });
    await add("workflow-a", "a-sem", "2026-09-10T00:00:02.000Z", { contributingExchangeIds: ["a-ex-1"] });
    await add("workflow-a", "a-2", "2026-09-10T00:00:03.000Z", { exchangeId: "a-ex-2", attemptStartSequence: 2 });
    await add("workflow-b", "b-1", "2026-09-10T00:00:00.000Z", { exchangeId: "b-ex-1", attemptStartSequence: 1 });
    const response = await handleGetSalesDiagnosticLog({ diagnostics, logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() } }, { customerId: "customer-certalis", query: { source: "sales-records", limit: "10" } });
    expect((response.body as { entries: Array<{ id: string; message: string }> }).entries.map((entry) => entry.message)).toEqual(["a-1", "a-sem", "a-2", "b-1"]);
  });
  it("preserves the earliest exchange when a correlation spans more than one source page", async () => {
    const diagnostics = createInMemoryDiagnosticLogRepository();
    for (let index = 0; index < 601; index += 1) await diagnostics.append({ source: "sales-records", operation: "x", outcome: "success", customerId: "customer-certalis", correlationId: "corr-long", message: String(index), occurredAt: new Date(Date.UTC(2026, 8, 10, 0, 0, index)), details: { exchangeId: `exchange-${index}`, attemptStartSequence: index + 1 } } as never);
    const response = await handleGetSalesDiagnosticLog({ diagnostics, logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() } }, { customerId: "customer-certalis", query: { correlationId: "corr-long", limit: "500" } });
    expect((response.body as { entries: Array<{ message: string }> }).entries[0]?.message).toBe("0");
    expect((response.body as { page: { hasMore: boolean; nextOffset: number | null } }).page).toMatchObject({ hasMore: true, nextOffset: 500 });
  });
  it("orders one correlated workflow by attempt sequence, exchange tie, and semantic adjacency", async () => {
    const diagnostics = createInMemoryDiagnosticLogRepository(); const at = new Date("2026-09-10T00:00:00.000Z");
    await diagnostics.append({ source: "sales-records", operation: "transport", outcome: "success", customerId: "customer-certalis", correlationId: "shared-workflow", occurredAt: at, details: { attemptStartSequence: 7, exchangeId: "exchange-b" }, message: "transport-b" } as never);
    await diagnostics.append({ source: "sales-records", operation: "semantic", outcome: "failure", customerId: "customer-certalis", correlationId: "shared-workflow", occurredAt: at, details: { contributingExchangeIds: ["exchange-a"] }, message: "semantic-a" } as never);
    await diagnostics.append({ source: "sales-records", operation: "transport", outcome: "success", customerId: "customer-certalis", correlationId: "shared-workflow", occurredAt: at, details: { attemptStartSequence: 7, exchangeId: "exchange-a" }, message: "transport-a" } as never);
    const response = await handleGetSalesDiagnosticLog({ diagnostics, logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() } }, { customerId: "customer-certalis", query: { correlationId: "shared-workflow", limit: "3" } });
    expect((response.body as { entries: Array<{ message: string }> }).entries.map((entry) => entry.message)).toEqual(["transport-a", "semantic-a", "transport-b"]);
  });
  it("does not use random exchange IDs to order legacy same-millisecond rows", async () => {
    const diagnostics = createInMemoryDiagnosticLogRepository(); const at = new Date("2026-09-10T00:00:00.000Z");
    await diagnostics.append({ id: "legacy-a", source: "sales-records", operation: "x", outcome: "success", customerId: "customer-certalis", correlationId: "legacy-corr", occurredAt: at, details: { exchangeId: "zz-random" }, message: "a" } as never);
    await diagnostics.append({ id: "legacy-b", source: "sales-records", operation: "x", outcome: "success", customerId: "customer-certalis", correlationId: "legacy-corr", occurredAt: at, details: { exchangeId: "aa-random" }, message: "b" } as never);
    const response = await handleGetSalesDiagnosticLog({ diagnostics, logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() } }, { customerId: "customer-certalis", query: { correlationId: "legacy-corr", limit: "10" } });
    expect((response.body as { entries: Array<{ message: string }> }).entries.map((entry) => entry.message)).toEqual(["a", "b"]);
  });
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

  it("returns Customer-scoped shared CloudShare exchanges through an explicit Sales Support source", async () => {
    const diagnostics = createInMemoryDiagnosticLogRepository();
    await diagnostics.append({ source: "cloudshare-integration", operation: "cloudshare.request", outcome: "success", customerId: "customer-certalis", correlationId: "corr-shared-1", message: "owned" });
    await diagnostics.append({ source: "cloudshare-integration", operation: "cloudshare.request", outcome: "failure", customerId: "customer-other", correlationId: "corr-shared-1", message: "other Customer" });

    const response = await handleGetSalesDiagnosticLog(
      { diagnostics, logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() } },
      { customerId: "customer-certalis", query: { source: "cloudshare-integration", correlationId: "corr-shared-1" } },
    );

    expect(response).toMatchObject({
      status: 200,
      body: { entries: [expect.objectContaining({ source: "cloudshare-integration", message: "owned" })] },
    });
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

  it("allows Sales Trial enrollment extension evidence to be correlated from Sales Support", async () => {
    const diagnostics = { append: vi.fn(), query: vi.fn().mockResolvedValue([]) };
    await handleGetSalesDiagnosticLog({ diagnostics, logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() } }, { customerId: "customer-certalis", query: { source: "sales-trial-enrollment", correlationId: "corr-trial-extend-failed" } });
    expect(diagnostics.query).toHaveBeenCalledWith(expect.objectContaining({ customerId: "customer-certalis", source: "sales-trial-enrollment", correlationId: "corr-trial-extend-failed" }));
  });

  it("follows a retained enrollment subject to its parent offering workflow evidence", async () => {
    const diagnostics = createInMemoryDiagnosticLogRepository();
    await diagnostics.append({ source: "sales-trial-offerings", operation: "sales.trial_offering.monitor.read_participants", outcome: "failure", customerId: "customer-certalis", subject: { type: "sales_trial_offering", id: "offering-1" }, externalIds: { offeringId: "offering-1" }, message: "504", occurredAt: new Date("2026-09-04T10:00:00.000Z") });
    await diagnostics.append({ source: "sales-trial-enrollment", operation: "sales.trial_enrollment.monitor.read_participants", outcome: "failure", customerId: "customer-certalis", subject: { type: "sales_trial_enrollment", id: "enrollment-1" }, externalIds: { offeringId: "offering-1", salesTrialEnrollmentId: "enrollment-1" }, message: "504", occurredAt: new Date("2026-09-04T10:01:00.000Z") });
    await diagnostics.append({ source: "sales-trial-offerings", operation: "unrelated", outcome: "failure", customerId: "customer-certalis", subject: { type: "sales_trial_offering", id: "offering-other" }, externalIds: { offeringId: "offering-other" }, message: "other", occurredAt: new Date("2026-09-04T10:02:00.000Z") });
    await diagnostics.append({ source: "sales-trial-enrollment", operation: "unrelated", outcome: "failure", customerId: "customer-certalis", subject: { type: "sales_trial_enrollment", id: "enrollment-other" }, externalIds: { offeringId: "offering-other", salesTrialEnrollmentId: "enrollment-other" }, message: "other", occurredAt: new Date("2026-09-04T10:03:00.000Z") });
    await diagnostics.append({ source: "sales-trial-offerings", operation: "other-customer", outcome: "failure", customerId: "customer-other", subject: { type: "sales_trial_offering", id: "offering-1" }, externalIds: { offeringId: "offering-1" }, message: "other", occurredAt: new Date("2026-09-04T10:04:00.000Z") });
    const response = await handleGetSalesDiagnosticLog({ diagnostics, salesTrialEnrollments: enrollmentRepo(), logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() } }, { customerId: "customer-certalis", query: { subjectId: "enrollment-1", subjectType: "sales_trial_enrollment" } });
    expect(response.status).toBe(200);
    const entries = (response.body as { entries: Array<{ source: string; subject: { id?: string } }> }).entries;
    expect(entries.map((entry) => `${entry.source}:${entry.subject.id}`)).toEqual(["sales-trial-enrollment:enrollment-1", "sales-trial-offerings:offering-1"]);
  });

  it("keeps legacy offering-subject monitoring rows visible in unfiltered causal views", async () => {
    const diagnostics = createInMemoryDiagnosticLogRepository();
    await diagnostics.append({
      source: "sales-trial-enrollment",
      operation: "sales_trial.offering.monitoring.read_participants",
      outcome: "success",
      customerId: "customer-certalis",
      subject: { type: "sales_trial_offering", id: "offering-1" },
      message: "legacy offering monitoring",
      occurredAt: new Date("2026-09-04T10:00:00.000Z"),
    });
    const deps = {
      diagnostics,
      salesTrialEnrollments: enrollmentRepo(),
      logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    };

    const offering = await handleGetSalesDiagnosticLog(deps, {
      customerId: "customer-certalis",
      query: { subjectId: "offering-1", subjectType: "sales_trial_offering" },
    });
    const enrollment = await handleGetSalesDiagnosticLog(deps, {
      customerId: "customer-certalis",
      query: { subjectId: "enrollment-1", subjectType: "sales_trial_enrollment" },
    });

    expect((offering.body as { entries: Array<{ message: string }> }).entries.map((entry) => entry.message)).toEqual(["legacy offering monitoring"]);
    expect((enrollment.body as { entries: Array<{ message: string }> }).entries.map((entry) => entry.message)).toEqual(["legacy offering monitoring"]);
  });

  it("returns offering evidence for the exact offering link query", async () => {
    const diagnostics = createInMemoryDiagnosticLogRepository();
    await diagnostics.append({ source: "sales-trial-offerings", operation: "offering.read", outcome: "failure", customerId: "customer-certalis", subject: { type: "sales_trial_offering", id: "offering-1" }, message: "504", occurredAt: new Date("2026-09-04T10:00:00Z") });
    await diagnostics.append({ source: "sales-trial-offerings", operation: "offering.read", outcome: "success", customerId: "customer-certalis", subject: { type: "sales_trial_offering", id: "offering-1" }, message: "recovered", occurredAt: new Date("2026-09-04T10:01:00Z") });
    const response = await handleGetSalesDiagnosticLog({ diagnostics, salesTrialEnrollments: enrollmentRepo(), logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() } }, { customerId: "customer-certalis", query: { source: "sales-trial-offerings", subjectId: "offering-1", subjectType: "sales_trial_offering" } });
    expect((response.body as { entries: Array<{ message: string }> }).entries.map((entry) => entry.message)).toEqual(["recovered", "504"]);
  });

  it("resolves an enrollment parent through the bounded Customer-scoped repository seam", async () => {
    const diagnostics = createInMemoryDiagnosticLogRepository();
    await diagnostics.append({ source: "sales-trial-enrollment", operation: "summary", outcome: "success", customerId: "customer-certalis", subject: { type: "sales_trial_enrollment", id: "enrollment-1" }, message: "enrollment", occurredAt: new Date("2026-09-04T09:00:00Z") });
    await diagnostics.append({ source: "sales-trial-offerings", operation: "summary", outcome: "success", customerId: "customer-certalis", subject: { type: "sales_trial_offering", id: "offering-1" }, message: "parent", occurredAt: new Date("2026-09-04T08:00:00Z") });
    const repo = enrollmentRepo();
    const response = await handleGetSalesDiagnosticLog({ diagnostics, salesTrialEnrollments: repo, logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() } }, { customerId: "customer-certalis", query: { subjectId: "enrollment-1", subjectType: "sales_trial_enrollment", limit: "10" } });
    expect(repo.findById).toHaveBeenCalledWith("customer-certalis", "enrollment-1");
    expect((response.body as { entries: Array<{ message: string }> }).entries.map((entry) => entry.message)).toEqual(["enrollment", "parent"]);
  });

  it("returns the full generic-subject page without advertising an inaccessible next page at the offset boundary", async () => {
    const diagnostics = createInMemoryDiagnosticLogRepository();
    for (let index = 0; index < 5501; index += 1) await diagnostics.append({ source: "sales-records", operation: "x", outcome: "success", customerId: "customer-certalis", subject: { type: "sales_record", id: "record-1" }, message: String(index), occurredAt: new Date(2026, 8, 4, 0, 0, index % 60) });
    const response = await handleGetSalesDiagnosticLog({ diagnostics, logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() } }, { customerId: "customer-certalis", query: { subjectId: "record-1", offset: "5000", limit: "500" } });
    expect(response).toMatchObject({ status: 200, body: { page: { returned: 500, hasMore: false, nextOffset: null } } });
  });

  it("keeps enrollment-source evidence when filtering an offering subject", async () => {
    const diagnostics = createInMemoryDiagnosticLogRepository();
    await diagnostics.append({ source: "sales-trial-enrollment", operation: "legacy", outcome: "failure", customerId: "customer-certalis", subject: { type: "sales_trial_offering", id: "offering-1" }, externalIds: { offeringId: "offering-1" }, message: "legacy enrollment evidence" });
    const response = await handleGetSalesDiagnosticLog({ diagnostics, salesTrialEnrollments: enrollmentRepo(), logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() } }, { customerId: "customer-certalis", query: { source: "sales-trial-enrollment", subjectType: "sales_trial_offering", subjectId: "offering-1" } });
    expect(response.status).toBe(200);
    expect((response.body as { entries: Array<{ message: string }> }).entries.map((entry) => entry.message)).toEqual(["legacy enrollment evidence"]);
  });

  it("F: source-filtered and aggregate Sales pages mark the 5000 boundary incomplete while ordinary pages remain complete", async () => {
    const diagnostics = createInMemoryDiagnosticLogRepository();
    for (let index = 0; index < 5001; index += 1) {
      await diagnostics.append({ source: "sales-records", operation: "x", outcome: "success", customerId: "customer-certalis", correlationId: "corr-cap", message: String(index), occurredAt: new Date(2026, 8, 4, 0, 0, index % 60) });
    }
    const deps = { diagnostics, logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() } };
    const source = await handleGetSalesDiagnosticLog(deps, { customerId: "customer-certalis", query: { source: "sales-records", offset: "4999", limit: "2" } });
    const aggregate = await handleGetSalesDiagnosticLog(deps, { customerId: "customer-certalis", query: { correlationId: "corr-cap", offset: "4999", limit: "2" } });
    for (const response of [source, aggregate]) expect(response).toMatchObject({ status: 200, body: { page: { complete: false, incompleteReason: "sales_diagnostic_offset_cap", hasMore: false, nextOffset: null } } });
    const ordinary = await handleGetSalesDiagnosticLog(deps, { customerId: "customer-certalis", query: { source: "sales-records", offset: "0", limit: "1" } });
    expect(ordinary).toMatchObject({ status: 200, body: { page: { complete: false, hasMore: true, nextOffset: 1 } } });
    await expect(handleGetSalesDiagnosticLog(deps, { customerId: "customer-certalis", query: { source: "sales-records", offset: "5001" } })).resolves.toMatchObject({ status: 400 });
  });

  it("returns only the exact enrollment and parent offering evidence in timestamp order", async () => {
    const diagnostics = createInMemoryDiagnosticLogRepository();
    const add = (input: Parameters<typeof diagnostics.append>[0]) => diagnostics.append(input);
    await add({ source: "sales-trial-enrollment", operation: "enrollment.read", outcome: "failure", customerId: "customer-certalis", subject: { type: "sales_trial_enrollment", id: "enrollment-1" }, externalIds: { offeringId: "offering-1" }, message: "enrollment 504", occurredAt: new Date("2026-09-04T10:01:00Z") });
    await add({ source: "sales-trial-offerings", operation: "offering.read", outcome: "failure", customerId: "customer-certalis", subject: { type: "sales_trial_offering", id: "offering-1" }, message: "parent 504", occurredAt: new Date("2026-09-04T10:02:00Z") });
    await add({ source: "sales-trial-offerings", operation: "offering.read", outcome: "success", customerId: "customer-certalis", subject: { type: "sales_trial_offering", id: "offering-1" }, message: "parent recovered", occurredAt: new Date("2026-09-04T10:03:00Z") });
    const response = await handleGetSalesDiagnosticLog({ diagnostics, salesTrialEnrollments: enrollmentRepo(), logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() } }, { customerId: "customer-certalis", query: { subjectId: "enrollment-1", subjectType: "sales_trial_enrollment", limit: "10" } });
    expect(response).toMatchObject({ status: 200, body: { page: { returned: 3, hasMore: false, nextOffset: null } } });
    expect((response.body as { entries: Array<{ message: string }> }).entries.map((entry) => entry.message)).toEqual(["parent recovered", "parent 504", "enrollment 504"]);
  });

  it("excludes sibling enrollment, other Customer evidence, and typed external-ID collisions", async () => {
    const diagnostics = createInMemoryDiagnosticLogRepository();
    await diagnostics.append({ source: "sales-trial-enrollment", operation: "x", outcome: "failure", customerId: "customer-certalis", subject: { type: "sales_trial_enrollment", id: "enrollment-1" }, externalIds: { offeringId: "offering-1" }, message: "exact" });
    await diagnostics.append({ source: "sales-trial-enrollment", operation: "x", outcome: "failure", customerId: "customer-certalis", subject: { type: "sales_trial_enrollment", id: "sibling" }, externalIds: { offeringId: "offering-1" }, message: "sibling" });
    await diagnostics.append({ source: "sales-trial-offerings", operation: "x", outcome: "failure", customerId: "customer-certalis", subject: { type: "sales_trial_offering", id: "enrollment-1" }, message: "collision" });
    await diagnostics.append({ source: "sales-trial-offerings", operation: "x", outcome: "failure", customerId: "other", subject: { type: "sales_trial_offering", id: "offering-1" }, message: "other customer" });
    const response = await handleGetSalesDiagnosticLog({ diagnostics, salesTrialEnrollments: enrollmentRepo(), logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() } }, { customerId: "customer-certalis", query: { subjectId: "enrollment-1", subjectType: "sales_trial_enrollment" } });
    expect((response.body as { entries: Array<{ message: string }> }).entries.map((entry) => entry.message)).toEqual(["exact"]);
  });

  it("paginates causal evidence and rejects offsets beyond the maximum", async () => {
    const diagnostics = createInMemoryDiagnosticLogRepository();
    for (let i = 0; i < 3; i++) await diagnostics.append({ source: i === 0 ? "sales-trial-enrollment" : "sales-trial-offerings", operation: "x", outcome: "success", customerId: "customer-certalis", subject: { type: i === 0 ? "sales_trial_enrollment" : "sales_trial_offering", id: i === 0 ? "enrollment-1" : "offering-1" }, externalIds: i === 0 ? { offeringId: "offering-1" } : undefined, message: String(i), occurredAt: new Date(2026, 8, 4, 10, i) });
    const deps = { diagnostics, salesTrialEnrollments: enrollmentRepo(), logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() } };
    const page = await handleGetSalesDiagnosticLog(deps, { customerId: "customer-certalis", query: { subjectId: "enrollment-1", subjectType: "sales_trial_enrollment", offset: "2", limit: "1" } });
    expect(page).toMatchObject({ status: 200, body: { page: { returned: 1, hasMore: false, nextOffset: null } } });
    const empty = await handleGetSalesDiagnosticLog(deps, { customerId: "customer-certalis", query: { subjectId: "enrollment-1", offset: "10", limit: "1" } });
    expect(empty).toMatchObject({ status: 200, body: { page: { returned: 0, hasMore: false } } });
    await expect(handleGetSalesDiagnosticLog(deps, { customerId: "customer-certalis", query: { subjectId: "enrollment-1", offset: "5001" } })).resolves.toMatchObject({ status: 400 });
  });
  it("keeps causal lookahead reachable at 101 rows and the 4900 to 5000 boundary", async () => {
    // The same fixture covers ordinary lookahead, the accepted boundary, and cap rejection.
    const diagnostics = createInMemoryDiagnosticLogRepository();
    for (let index = 0; index < 5002; index += 1) await diagnostics.append({ source: "sales-trial-enrollment", operation: "x", outcome: "success", customerId: "customer-certalis", subject: { type: "sales_trial_enrollment", id: "enrollment-1" }, message: String(index), occurredAt: new Date(Date.UTC(2026, 8, 4, 0, 0, index % 60)) } as never);
    const deps = { diagnostics, salesTrialEnrollments: enrollmentRepo(), logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() } };
    const first = await handleGetSalesDiagnosticLog(deps, { customerId: "customer-certalis", query: { subjectId: "enrollment-1", subjectType: "sales_trial_enrollment", limit: "100" } });
    expect(first).toMatchObject({ body: { page: { returned: 100, hasMore: true, nextOffset: 100 } } });
    const boundary = await handleGetSalesDiagnosticLog(deps, { customerId: "customer-certalis", query: { subjectId: "enrollment-1", subjectType: "sales_trial_enrollment", offset: "4900", limit: "100" } });
    expect(boundary).toMatchObject({ body: { page: { returned: 100, hasMore: true, nextOffset: 5000, complete: false } } });
    const cap = await handleGetSalesDiagnosticLog(deps, { customerId: "customer-certalis", query: { subjectId: "enrollment-1", subjectType: "sales_trial_enrollment", offset: "5000", limit: "1" } });
    expect(cap).toMatchObject({ body: { page: { returned: 1, hasMore: false, nextOffset: null, complete: false, incompleteReason: "sales_diagnostic_offset_cap" } } });
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
    expect(diagnostics.query).toHaveBeenCalledWith(expect.objectContaining({ customerId: "customer-certalis", source: "cloudshare-integration" }));
    expect(diagnostics.query).toHaveBeenCalledWith(expect.objectContaining({ customerId: "customer-certalis", source: "sales-session-reconciliation" }));
    expect(diagnostics.query).toHaveBeenCalledWith(expect.objectContaining({ customerId: "customer-certalis", source: "sales-project-members" }));
    expect(diagnostics.query).toHaveBeenCalledWith(expect.objectContaining({ customerId: "customer-certalis", source: "sales-session-participants" }));
    expect(diagnostics.query).toHaveBeenCalledWith(expect.objectContaining({ customerId: "customer-certalis", source: "sales-trial-enrollment" }));
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

  it("resolves the enrollment parent even when filters exclude child events", async () => {
    const diagnostics = createInMemoryDiagnosticLogRepository();
    await diagnostics.append({ source: "sales-trial-offerings", operation: "monitor", outcome: "failure", customerId: "customer-certalis", subject: { type: "sales_trial_offering", id: "offering-1" }, message: "504", occurredAt: new Date("2026-09-04T10:00:00Z") });
    const repo = enrollmentRepo();
    const response = await handleGetSalesDiagnosticLog({ diagnostics, salesTrialEnrollments: repo, logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() } }, { customerId: "customer-certalis", query: { subjectType: "sales_trial_enrollment", subjectId: "enrollment-1", outcome: "failure", operation: "monitor" } });
    expect(repo.findById).toHaveBeenCalledWith("customer-certalis", "enrollment-1");
    expect((response.body as { entries: Array<{ message: string }> }).entries.map((entry) => entry.message)).toEqual(["504"]);
  });

  it("keeps untyped subject IDs on the generic aggregate path", async () => {
    const diagnostics = createInMemoryDiagnosticLogRepository();
    await diagnostics.append({ source: "sales-records", operation: "record.read", outcome: "success", customerId: "customer-certalis", subject: { type: "sales_record", id: "record-1" }, message: "record" });
    const repo = enrollmentRepo();
    const response = await handleGetSalesDiagnosticLog({ diagnostics, salesTrialEnrollments: repo, logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() } }, { customerId: "customer-certalis", query: { subjectId: "record-1" } });
    expect((response.body as { entries: Array<{ message: string }> }).entries.map((entry) => entry.message)).toContain("record");
    expect(repo.findById).not.toHaveBeenCalled();
  });

  it("partitions explicit enrollment evidence by requested Sales source", async () => {
    const diagnostics = createInMemoryDiagnosticLogRepository();
    await diagnostics.append({ source: "sales-trial-enrollment", operation: "monitor", outcome: "failure", customerId: "customer-certalis", subject: { type: "sales_trial_enrollment", id: "enrollment-1" }, message: "child", occurredAt: new Date("2026-09-04T10:00:00Z") });
    await diagnostics.append({ source: "sales-trial-offerings", operation: "monitor", outcome: "failure", customerId: "customer-certalis", subject: { type: "sales_trial_offering", id: "offering-1" }, message: "parent", occurredAt: new Date("2026-09-04T10:01:00Z") });
    const repo = enrollmentRepo();
    const deps = { diagnostics, salesTrialEnrollments: repo, logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() } };
    const child = await handleGetSalesDiagnosticLog(deps, { customerId: "customer-certalis", query: { subjectType: "sales_trial_enrollment", subjectId: "enrollment-1", source: "sales-trial-enrollment" } });
    const parent = await handleGetSalesDiagnosticLog(deps, { customerId: "customer-certalis", query: { subjectType: "sales_trial_enrollment", subjectId: "enrollment-1", source: "sales-trial-offerings" } });
    const unrelated = await handleGetSalesDiagnosticLog(deps, { customerId: "customer-certalis", query: { subjectType: "sales_trial_enrollment", subjectId: "enrollment-1", source: "sales-records" } });
    expect((child.body as { entries: Array<{ message: string }> }).entries.map((entry) => entry.message)).toEqual(["child"]);
    expect((parent.body as { entries: Array<{ message: string }> }).entries.map((entry) => entry.message)).toEqual(["parent"]);
    expect((unrelated.body as { entries: unknown[] }).entries).toEqual([]);
  });
});
