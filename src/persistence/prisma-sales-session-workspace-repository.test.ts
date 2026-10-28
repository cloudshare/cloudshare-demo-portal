import { describe, expect, it, vi } from "vitest";
import { createPrismaSalesSessionWorkspaceRepository } from "./prisma-sales-session-workspace-repository";

describe("Prisma Sales Session workspace repository", () => {
  const session = (overrides: Record<string, unknown> = {}) => ({ id: "session-1", customerId: "customer-a", cloudShareSalesExperienceId: "sales-1", sessionName: "Acme", revision: 1, start: "2026-07-25T09:00:00.000Z", end: "2026-07-25T10:00:00.000Z", timeZone: "UTC", operationalStatus: "active", attentionReason: null, experienceStatus: null, experienceStatusObservedAt: null, experienceStatusSource: null, sendInvitations: "dontSend", opportunity: { name: "Evaluation", account: { name: "Acme" } }, item: { name: "Item" }, participants: [], ...overrides });
  const row = (id: string, correlationId: string | null, at = "2026-07-24T09:00:00.000Z", operation = "sales.demo_session.created", outcome = "success") => ({ id, occurredAt: new Date(at), operation, outcome, actorType: "system", subjectType: "sales_demo_session", subjectId: "session-1", correlationId });
  it("owns Customer and active relationship predicates and never selects protected diagnostic JSON", async () => {
    const findFirst = vi.fn().mockResolvedValue(null);
    const findMany = vi.fn();
    const repository = createPrismaSalesSessionWorkspaceRepository({ salesDemoSession: { findFirst }, diagnosticLogEntry: { findMany } } as never);

    await expect(repository.read("customer-a", "session-b")).resolves.toBeNull();

    expect(findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: { customerId: "customer-a", id: "session-b", opportunity: { archivedAt: null, account: { archivedAt: null } } } }));
    expect(findMany).not.toHaveBeenCalled();
  });

  it("reads Activity through safe metadata columns only", async () => {
    const findMany = vi.fn().mockResolvedValue([{ occurredAt: new Date("2026-07-24T09:00:00Z"), operation: "sales.demo_session.created", outcome: "failure", message: "Bearer token loginUrl=https://unsafe.example", requestJson: "Authorization: secret", responseJson: "envId=provider-reference", actorType: "admin", subjectType: "sales_demo_session", subjectId: "session-1", correlationId: "corr-1" }]);
    const repository = createPrismaSalesSessionWorkspaceRepository({ salesDemoSession: { findFirst: vi.fn().mockResolvedValue({ id: "session-1", customerId: "customer-a", cloudShareSalesExperienceId: "sales-1", sessionName: "Acme", revision: 1, start: "2026-07-25T09:00:00.000Z", end: "2026-07-25T10:00:00.000Z", timeZone: "UTC", operationalStatus: "active", attentionReason: null, experienceStatus: null, experienceStatusObservedAt: null, sendInvitations: "dontSend", opportunity: { name: "Evaluation", account: { name: "Acme" } }, item: { name: "Item" }, participants: [] }) }, diagnosticLogEntry: { findMany } } as never);

    const result = await repository.read("customer-a", "session-1");

    const query = findMany.mock.calls[0][0];
    expect(query.where).toEqual({ customerId: "customer-a", subjectId: "session-1", subjectType: "sales_demo_session" });
    expect(query.select).not.toHaveProperty("requestJson");
    expect(query.select).not.toHaveProperty("responseJson");
    expect(query.select).not.toHaveProperty("detailsJson");
    expect(query.select).not.toHaveProperty("message");
    expect(JSON.stringify(result)).not.toMatch(/Bearer|loginUrl|Authorization|envId|provider-reference/);
  });

  it("marks only a persisted pending pre-dispatch reservation as stale", async () => {
    const repository = createPrismaSalesSessionWorkspaceRepository({ salesDemoSession: { findFirst: vi.fn().mockResolvedValue({ id: "session-pending", cloudShareSalesExperienceId: "pending:reservation", operationalStatus: "provisioning", opportunity: { account: {} } }) }, diagnosticLogEntry: { findMany: vi.fn() } } as never);
    await expect(repository.read("customer-a", "session-pending")).resolves.toEqual({ state: "stale" });
  });

  it.each([
    ["confirmed", true, {}],
    ["admission only", false, {}],
    ["different Customer", true, { customerId: "customer-b" }],
    ["different Session", true, { sessionId: "session-2" }],
    ["different correlation", true, { commandId: "other-command" }],
    ["different operation", true, { operation: "extension" }],
  ] as const)("projects future cancellation Activity from durable completion: %s", async (scenario, finished, overrides) => {
    const completed = scenario === "confirmed";
    const rows = [
      row("cancel-admitted", "corr-cancel", "2026-07-24T09:00:00.000Z", "sales.demo_session.cancel"),
      ...(finished ? [row("absence-readback", "corr-cancel", "2026-07-24T09:00:00.500Z", "cloudshare.http", "failure")] : []),
      ...(finished ? [row("cancel-confirmed", "corr-cancel", "2026-07-24T09:00:01.000Z", "sales.demo_session.cancel")] : []),
    ];
    const command = {
      customerId: "customer-a", sessionId: "session-1", commandId: "corr-cancel", experienceId: "sales-1",
      cancelledAt: "2026-07-24T09:00:00.000Z", actor: { type: "admin", id: "admin-a" },
      timeZone: "UTC", targetEnd: "2026-07-24T09:00", targets: [], revision: 2, accessState: "pending",
      finished, deletion: { state: finished ? "confirmed" : "pending", providerStart: "2026-07-25T09:00", timeZone: "UTC" },
    };
    const commandRow = { customerId: command.customerId, sessionId: command.sessionId, commandId: command.commandId, operation: "cancellation", state: JSON.stringify(command), revision: command.revision, ...overrides };
    const repository = createPrismaSalesSessionWorkspaceRepository({
      salesDemoSession: { findFirst: vi.fn().mockResolvedValue(session()) },
      diagnosticLogEntry: { findMany: vi.fn().mockResolvedValue(rows) },
      salesParticipantExtensionCommand: { findMany: vi.fn().mockResolvedValue([commandRow]) },
    } as never);

    const result = await repository.read("customer-a", "session-1");

    expect(result).toMatchObject({ state: "available", workspace: { activityGroups: [
      { correlationId: "corr-cancel", outcome: completed ? "success" : "incomplete", summary: completed ? "Sales Session cancelled." : "Business outcome and evidence are incomplete." },
    ] } });
    expect(JSON.stringify(result)).not.toMatch(/providerStart|targetEnd|admin-a|accessState/);
    if (completed && result?.state === "available") expect(result.workspace.activityGroups[0].steps).toEqual(expect.arrayContaining([expect.objectContaining({ outcome: "failure" })]));
  });

  it("groups realistic high-volume child history before applying the workflow limit", async () => {
    const childOperations = ["sales.demo_session.participant_properties.ensured", "sales.demo_session.participant_correlation.backfilled", "sales.demo_session.participant.environment_observed", "sales.demo_session.participant.reconciled"];
    const rows = Array.from({ length: 101 }, (_, i) => row(`child-${i}`, "corr-one", `2026-07-24T09:00:${String(i % 60).padStart(2, "0")}.${String(i).padStart(3, "0")}Z`, childOperations[i % childOperations.length]))
      .concat([row("terminal", "corr-one", "2026-07-24T09:02:00.000Z", "sales.demo_session.participants.registered")]);
    const findMany = vi.fn().mockResolvedValue(rows);
    const repository = createPrismaSalesSessionWorkspaceRepository({ salesDemoSession: { findFirst: vi.fn().mockResolvedValue(session()) }, diagnosticLogEntry: { findMany } } as never);
    const result = await repository.read("customer-a", "session-1");
    expect(result).toMatchObject({ state: "available", workspace: { activityGroups: [{ correlationId: "corr-one", count: 102, outcome: "success" }], activityHistory: { presentedWorkflowCount: 1, totalWorkflowCount: 1, hasMore: false, complete: true } } });
  });

  it("keeps workflows distinct and omits the probe row while marking a boundary workflow incomplete", async () => {
    const rows = [...Array.from({ length: 5500 }, (_, i) => row(`row-${i}`, i === 5499 ? "boundary" : `corr-${i}`, "2026-07-24T09:00:00.000Z")), row("probe", "boundary", "2026-07-24T09:00:00.000Z")];
    const findMany = vi.fn().mockResolvedValue(rows);
    const repository = createPrismaSalesSessionWorkspaceRepository({ salesDemoSession: { findFirst: vi.fn().mockResolvedValue(session()) }, diagnosticLogEntry: { findMany } } as never);
    const result = await repository.read("customer-a", "session-1");
    if (!result || result.state !== "available") throw new Error("expected workspace");
    expect(result.workspace.activity.some((entry) => entry.activityId === "probe")).toBe(false);
    expect(result.workspace.activityHistory).toMatchObject({ complete: false, hasMore: true, reason: "source_scan_limit" });
    expect(result.workspace.activityGroups.every((group) => group.outcome === "incomplete")).toBe(true);
    expect(result.workspace.activityGroups.every((group) => group.summary === "Business outcome and evidence are incomplete.")).toBe(true);
  });

  it("scopes retained ambiguity to the persisted creation correlation", async () => {
    const rows = [row("ambiguous", "corr-ambiguous", "2026-07-24T09:00:00.000Z", "sales.demo_session.created", "failure"), row("duplicate", "corr-duplicate", "2026-07-24T09:01:00.000Z", "sales.demo_session.created", "failure")];
    const findFirst = vi.fn().mockResolvedValue(session({ operationalStatus: "needs_attention", attentionReason: "cloudshare_v4_post_sales_ambiguous: unknown outcome correlationId:corr-ambiguous" }));
    const repository = createPrismaSalesSessionWorkspaceRepository({ salesDemoSession: { findFirst }, diagnosticLogEntry: { findMany: vi.fn().mockResolvedValue(rows) } } as never);
    const result = await repository.read("customer-a", "session-1");
    if (!result || result.state !== "available") throw new Error("expected workspace");
    expect(result.workspace.activityGroups).toEqual(expect.arrayContaining([
      expect.objectContaining({ correlationId: "corr-ambiguous", outcome: "incomplete", summary: "Business outcome and evidence are incomplete." }),
      expect.objectContaining({ correlationId: "corr-duplicate", outcome: "failure", summary: "Sales Session provision failed." }),
    ]));
  });

  it("keeps every plausible legacy failed creation correlation distinct and incomplete", async () => {
    const rows = [row("later", "corr-duplicate", "2026-07-24T09:01:00.000Z", "sales.demo_session.created", "failure"), row("earlier", "corr-ambiguous", "2026-07-24T09:00:00.000Z", "sales.demo_session.created", "failure")];
    const findFirst = vi.fn().mockResolvedValue(session({ operationalStatus: "needs_attention", attentionReason: "cloudshare_v4_post_sales_ambiguous: legacy retained reason" }));
    const repository = createPrismaSalesSessionWorkspaceRepository({ salesDemoSession: { findFirst }, diagnosticLogEntry: { findMany: vi.fn().mockResolvedValue(rows) } } as never);
    const result = await repository.read("customer-a", "session-1");
    if (!result || result.state !== "available") throw new Error("expected workspace");
    expect(result.workspace.activityGroups).toEqual(expect.arrayContaining([
      expect.objectContaining({ correlationId: "corr-ambiguous", outcome: "incomplete" }),
      expect.objectContaining({ correlationId: "corr-duplicate", outcome: "incomplete" }),
    ]));
  });

  it("reports a truthful workflow presentation limit after complete source grouping", async () => {
    const rows = Array.from({ length: 101 }, (_, index) => row(`workflow-${index}`, `corr-${index}`, `2026-07-24T09:00:${String(index % 60).padStart(2, "0")}.${String(index).padStart(3, "0")}Z`));
    const repository = createPrismaSalesSessionWorkspaceRepository({ salesDemoSession: { findFirst: vi.fn().mockResolvedValue(session()) }, diagnosticLogEntry: { findMany: vi.fn().mockResolvedValue(rows) } } as never);
    const result = await repository.read("customer-a", "session-1");
    if (!result || result.state !== "available") throw new Error("expected workspace");
    expect(result.workspace.activityGroups).toHaveLength(100);
    expect(result.workspace.activityHistory).toMatchObject({ complete: false, hasMore: true, reason: "workflow_presentation_limit", presentedWorkflowCount: 100, totalWorkflowCount: 101 });
  });

  it("uses persisted ids as the deterministic tie breaker and fails closed across Customers", async () => {
    const findFirst = vi.fn().mockResolvedValue(null);
    const repository = createPrismaSalesSessionWorkspaceRepository({ salesDemoSession: { findFirst }, diagnosticLogEntry: { findMany: vi.fn() } } as never);
    await expect(repository.read("customer-b", "session-1")).resolves.toBeNull();
    expect(findFirst.mock.calls[0][0].where).toEqual({ customerId: "customer-b", id: "session-1", opportunity: { archivedAt: null, account: { archivedAt: null } } });
  });
});
