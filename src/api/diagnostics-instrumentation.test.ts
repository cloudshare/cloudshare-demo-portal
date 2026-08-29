import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  createInMemoryPortalSessionStore,
  createInMemoryPortalUserStore,
  createPortalAuthenticator,
  hashPassword,
  type CreatePortalUserInput,
  type PortalCustomerRecord,
  type PortalUserProvisioningStore,
  type PortalUserRecord,
} from "@/auth";
import { createLogger } from "@/observability/logger";
import {
  createDiagnosticRecorder,
  type DiagnosticRecorder,
} from "@/domain/diagnostic-log";
import { createInMemoryDiagnosticLogRepository } from "@/persistence/diagnostic-log-repository";
import { handlePortalLogin, handlePortalLogout } from "./portal-auth";
import {
  buildAdminDiagnosticLogDeps,
  handleGetDiagnosticLog,
  type AdminDiagnosticLogServices,
} from "./admin";
import { handleCandidateSelfRegistration } from "./candidate-portal";

const noopLogger = createLogger({ secrets: [], sink: () => {} });

function diagnosticsHarness(): {
  repository: ReturnType<typeof createInMemoryDiagnosticLogRepository>;
  recorder: DiagnosticRecorder;
} {
  const repository = createInMemoryDiagnosticLogRepository();
  const recorder = createDiagnosticRecorder({ repository });
  return { repository, recorder };
}

async function adminAuth() {
  const passwordHash = await hashPassword("correct-horse-battery-staple");
  return createPortalAuthenticator({
    users: createInMemoryPortalUserStore([
      {
        id: "user-1",
        customerId: "customer-helios",
        email: "admin@helioscx.demo",
        passwordHash,
        role: "admin",
      },
    ]),
    sessions: createInMemoryPortalSessionStore(),
    newSessionId: () => "portal-session-1",
  });
}

async function candidateAuth() {
  const passwordHash = await hashPassword("correct-horse-battery-staple");
  return createPortalAuthenticator({
    users: createInMemoryPortalUserStore([
      {
        id: "cand-1",
        customerId: "customer-helios",
        email: "candidate@helioscx.demo",
        passwordHash,
        role: "candidate",
      },
    ]),
    sessions: createInMemoryPortalSessionStore(),
    newSessionId: () => "portal-session-cand",
  });
}

/** Minimal provisioning store for registration emission tests. */
function inMemoryProvisioningStore(): PortalUserProvisioningStore {
  const byEmail = new Map<string, PortalUserRecord>();
  const customers: PortalCustomerRecord[] = [
    { id: "customer-helios", slug: "helios-cx", name: "Helios CX" },
  ];
  let seq = 0;
  return {
    async findByEmail(email) {
      return byEmail.get(email.trim().toLowerCase()) ?? null;
    },
    async findCustomerBySlug(slug) {
      return customers.find((c) => c.slug === slug) ?? null;
    },
    async findSalesTrialCustomer() {
      return null;
    },
    async createUser(input: CreatePortalUserInput) {
      const record: PortalUserRecord = { id: `user-${++seq}`, ...input };
      byEmail.set(record.email.toLowerCase(), record);
      return record;
    },
  };
}

describe("portal login diagnostics", () => {
  it("emits a success entry with actor and customer anchors", async () => {
    const { repository, recorder } = diagnosticsHarness();
    await handlePortalLogin(
      { portalAuth: await adminAuth(), diagnostics: recorder },
      { body: { email: "admin@helioscx.demo", password: "correct-horse-battery-staple" } },
    );

    const [entry] = await repository.query({ customerId: "customer-helios" });
    expect(entry).toMatchObject({
      source: "auth",
      operation: "portal.login",
      outcome: "success",
      customerId: "customer-helios",
      actor: { type: "admin", id: "user-1", email: "admin@helioscx.demo" },
    });
  });

  it("tags a candidate login with the candidate actor type and candidate email", async () => {
    const { repository, recorder } = diagnosticsHarness();
    await handlePortalLogin(
      { portalAuth: await candidateAuth(), diagnostics: recorder },
      { body: { email: "candidate@helioscx.demo", password: "correct-horse-battery-staple" } },
    );

    const [entry] = await repository.query({ customerId: "customer-helios" });
    expect(entry).toMatchObject({
      operation: "portal.login",
      outcome: "success",
      actor: { type: "candidate", id: "cand-1", email: "candidate@helioscx.demo" },
      candidateEmail: "candidate@helioscx.demo",
    });
  });

  it("emits a failure entry without the submitted password", async () => {
    const { repository, recorder } = diagnosticsHarness();
    await handlePortalLogin(
      { portalAuth: await adminAuth(), diagnostics: recorder },
      { body: { email: "admin@helioscx.demo", password: "wrong" } },
    );

    const entries = await repository.query();
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      operation: "portal.login",
      outcome: "failure",
      actor: { type: "anonymous", email: "admin@helioscx.demo" },
    });
    expect(JSON.stringify(entries[0])).not.toContain("wrong");
  });

  it("attributes a failed login to the owning Customer when the email is known, so it is visible in the scoped view", async () => {
    const { repository, recorder } = diagnosticsHarness();
    const users = createInMemoryPortalUserStore([
      {
        id: "user-1",
        customerId: "customer-helios",
        email: "admin@helioscx.demo",
        passwordHash: "x",
        role: "admin",
      },
    ]);

    await handlePortalLogin(
      { portalAuth: await adminAuth(), diagnostics: recorder, users },
      { body: { email: "admin@helioscx.demo", password: "wrong" } },
    );

    const scoped = await handleGetDiagnosticLog(
      { diagnostics: repository, logger: noopLogger },
      { query: {}, customerId: "customer-helios" },
    );
    const failure = (scoped.body.entries as Array<{ outcome: string; customerId: string }>).find(
      (e) => e.outcome === "failure",
    );
    expect(failure?.customerId).toBe("customer-helios");
  });

  it("leaves a failed login for an unknown email unattributed (anonymous, null Customer)", async () => {
    const { repository, recorder } = diagnosticsHarness();
    const users = createInMemoryPortalUserStore([]);
    await handlePortalLogin(
      { portalAuth: await adminAuth(), diagnostics: recorder, users },
      { body: { email: "nobody@example.com", password: "wrong" } },
    );
    const [entry] = await repository.query();
    expect(entry).toMatchObject({ outcome: "failure", customerId: null, actor: { type: "anonymous" } });
  });
});

describe("portal logout diagnostics", () => {
  it("emits a logout entry carrying the resumed actor identity", async () => {
    const { repository, recorder } = diagnosticsHarness();
    const portalAuth = await adminAuth();
    const login = await handlePortalLogin(
      { portalAuth, diagnostics: recorder },
      { body: { email: "admin@helioscx.demo", password: "correct-horse-battery-staple" } },
    );

    await handlePortalLogout(
      { portalAuth, diagnostics: recorder },
      { sessionId: login.session?.sessionId },
    );

    const logout = (await repository.query()).find((e) => e.operation === "portal.logout");
    expect(logout).toMatchObject({
      outcome: "success",
      customerId: "customer-helios",
      actor: { type: "admin", email: "admin@helioscx.demo" },
    });
  });

  it("emits a failure entry and rethrows when sign-out fails", async () => {
    const { repository, recorder } = diagnosticsHarness();
    const portalAuth = {
      async signIn() {
        throw new Error("unused");
      },
      async resume() {
        return {
          sessionId: "s1",
          userId: "user-1",
          customerId: "customer-helios",
          role: "admin" as const,
          email: "admin@helioscx.demo",
          firstName: null,
          lastName: null,
          issuedAtMs: 0,
        };
      },
      async signOut() {
        throw new Error("session store offline");
      },
    };

    await expect(
      handlePortalLogout({ portalAuth, diagnostics: recorder }, { sessionId: "s1" }),
    ).rejects.toThrow("session store offline");

    const logout = (await repository.query()).find((e) => e.operation === "portal.logout");
    expect(logout).toMatchObject({ outcome: "failure", customerId: "customer-helios" });
  });
});

describe("candidate account creation diagnostics", () => {
  it("emits success with Customer and Candidate anchors", async () => {
    const { repository, recorder } = diagnosticsHarness();
    await handleCandidateSelfRegistration(
      { users: inMemoryProvisioningStore(), logger: noopLogger, diagnostics: recorder },
      {
        body: {
          firstName: "Pat",
          lastName: "Lee",
          email: "Pat@example.com",
          password: "correct-horse-battery-staple",
        },
      },
    );

    const [entry] = await repository.query({ customerId: "customer-helios" });
    expect(entry).toMatchObject({
      source: "candidate-portal",
      operation: "candidate.account.create",
      outcome: "success",
      customerId: "customer-helios",
      candidateEmail: "pat@example.com",
      subject: { type: "candidate" },
    });
  });

  it("emits failure on duplicate email", async () => {
    const { repository, recorder } = diagnosticsHarness();
    const users = inMemoryProvisioningStore();
    const deps = { users, logger: noopLogger, diagnostics: recorder };
    const body = {
      firstName: "Pat",
      lastName: "Lee",
      email: "pat@example.com",
      password: "correct-horse-battery-staple",
    };
    await handleCandidateSelfRegistration(deps, { body });
    await handleCandidateSelfRegistration(deps, { body });

    const failures = (await repository.query()).filter((e) => e.outcome === "failure");
    expect(failures).toHaveLength(1);
    expect(failures[0]).toMatchObject({
      operation: "candidate.account.create",
      candidateEmail: "pat@example.com",
    });
  });

  it("makes a duplicate-registration failure visible in the owning Customer's scoped view", async () => {
    const repository = createInMemoryDiagnosticLogRepository();
    const recorder = createDiagnosticRecorder({ repository });
    const deps = { users: inMemoryProvisioningStore(), logger: noopLogger, diagnostics: recorder };
    const body = {
      firstName: "Pat",
      lastName: "Lee",
      email: "pat@example.com",
      password: "correct-horse-battery-staple",
    };
    await handleCandidateSelfRegistration(deps, { body });
    await handleCandidateSelfRegistration(deps, { body });

    const scoped = await handleGetDiagnosticLog(
      { diagnostics: repository, logger: noopLogger },
      { query: {}, customerId: "customer-helios" },
    );
    const failure = (scoped.body.entries as Array<{ outcome: string; customerId: string }>).find(
      (e) => e.outcome === "failure",
    );
    expect(failure?.customerId).toBe("customer-helios");
  });
});

describe("recorder → repository redaction (end to end)", () => {
  it("persists protected body evidence while masking request headers", async () => {
    const repository = createInMemoryDiagnosticLogRepository();
    const recorder = createDiagnosticRecorder({
      repository,
      secrets: ["sk-live-supersecret"],
    });

    await recorder.record({
      source: "integration",
      operation: "cloudshare.read",
      outcome: "success",
      message: "used sk-live-supersecret",
      customerId: "customer-a",
      details: { apiKey: "sk-live-supersecret", note: "fine" },
      request: { headers: { authorization: "Bearer sk-live-supersecret" } },
    });

    const [entry] = await repository.query({ customerId: "customer-a" });
    expect(JSON.stringify(entry)).toContain("sk-live-supersecret");
    expect(entry.message).toBe("used sk-live-supersecret");
    expect(entry.details).toMatchObject({ apiKey: "sk-live-supersecret", note: "fine" });
  });
});

describe("handleGetDiagnosticLog", () => {
  it("maps admin diagnostic-log dependencies from composed portal services", () => {
    const services = {
      diagnostics: createInMemoryDiagnosticLogRepository(),
      logger: noopLogger,
    } satisfies AdminDiagnosticLogServices;

    const deps = buildAdminDiagnosticLogDeps(services);

    expect(deps).toEqual({
      diagnostics: services.diagnostics,
      logger: services.logger,
    });
  });

  it("keeps the Next route adapter from inlining diagnostic-log wiring", () => {
    const routeSource = readFileSync("app/api/admin/diagnostics/route.ts", "utf8");

    expect(routeSource).toContain("buildAdminDiagnosticLogDeps");
    expect(routeSource).not.toContain("diagnostics: services.diagnostics");
  });

  it("returns only the caller's Customer entries (isolation)", async () => {
    const repository = createInMemoryDiagnosticLogRepository();
    await repository.append({
      source: "auth",
      operation: "portal.login",
      outcome: "success",
      message: "a",
      customerId: "customer-a",
    });
    await repository.append({
      source: "auth",
      operation: "portal.login",
      outcome: "success",
      message: "b",
      customerId: "customer-b",
    });

    const response = await handleGetDiagnosticLog(
      { diagnostics: repository, logger: noopLogger },
      { query: {}, customerId: "customer-a" },
    );

    const entries = response.body.entries as Array<{ customerId: string }>;
    expect(response.status).toBe(200);
    expect(entries).toHaveLength(1);
    expect(entries[0].customerId).toBe("customer-a");
  });

  it("filters by ExamAttempt ID within the Customer scope", async () => {
    const repository = createInMemoryDiagnosticLogRepository();
    await repository.append({
      source: "scheduling",
      operation: "exam_attempt.schedule",
      outcome: "success",
      message: "a",
      customerId: "customer-a",
      examAttemptId: "attempt-1",
    });
    await repository.append({
      source: "scheduling",
      operation: "exam_attempt.schedule",
      outcome: "success",
      message: "b",
      customerId: "customer-a",
      examAttemptId: "attempt-2",
    });

    const response = await handleGetDiagnosticLog(
      { diagnostics: repository, logger: noopLogger },
      { query: { examAttemptId: "attempt-1" }, customerId: "customer-a" },
    );
    const entries = response.body.entries as Array<{ examAttemptId: string }>;
    expect(entries).toHaveLength(1);
    expect(entries[0].examAttemptId).toBe("attempt-1");
  });

  it("filters by Exam ID and operation within the Customer scope", async () => {
    const repository = createInMemoryDiagnosticLogRepository();
    await repository.append({
      source: "admin-exams",
      operation: "exam.publish",
      outcome: "success",
      message: "published",
      customerId: "customer-a",
      examId: "exam-1",
    });
    await repository.append({
      source: "admin-exams",
      operation: "exam.update",
      outcome: "success",
      message: "updated",
      customerId: "customer-a",
      examId: "exam-1",
    });
    await repository.append({
      source: "admin-exams",
      operation: "exam.publish",
      outcome: "success",
      message: "other exam",
      customerId: "customer-a",
      examId: "exam-2",
    });

    const response = await handleGetDiagnosticLog(
      { diagnostics: repository, logger: noopLogger },
      {
        query: { examId: "exam-1", operation: "exam.publish" },
        customerId: "customer-a",
      },
    );

    const entries = response.body.entries as Array<{ examId: string; operation: string }>;
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ examId: "exam-1", operation: "exam.publish" });
  });

  it("filters by candidate email, outcome, source, correlation ID, integration surface, and external ID", async () => {
    const repository = createInMemoryDiagnosticLogRepository();
    await repository.append({
      occurredAt: new Date("2026-06-21T10:00:00.000Z"),
      source: "runtime",
      operation: "exam_attempt.resume",
      outcome: "failure",
      message: "resume failed",
      customerId: "customer-a",
      candidateEmail: "candidate@helioscx.demo",
      correlationId: "corr-match",
      externalIds: {
        environmentId: "env-123",
        trainingId: "training-456",
      },
      details: {
        integrationSurface: "cloudshare.v4.environment",
      },
    });
    await repository.append({
      occurredAt: new Date("2026-06-21T10:01:00.000Z"),
      source: "runtime",
      operation: "exam_attempt.resume",
      outcome: "success",
      message: "resume worked",
      customerId: "customer-a",
      candidateEmail: "other@helioscx.demo",
      correlationId: "corr-other",
      externalIds: {
        environmentId: "env-999",
      },
      details: {
        integrationSurface: "cloudshare.v4.environment",
      },
    });

    const response = await handleGetDiagnosticLog(
      { diagnostics: repository, logger: noopLogger },
      {
        query: {
          candidateEmail: "Candidate@HeliosCX.demo",
          outcome: "failure",
          source: "runtime",
          correlationId: "corr-match",
          integrationSurface: "cloudshare.v4.environment",
          externalId: "env-123",
        },
        customerId: "customer-a",
      },
    );

    const entries = response.body.entries as Array<{ candidateEmail: string; correlationId: string }>;
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      candidateEmail: "candidate@helioscx.demo",
      correlationId: "corr-match",
    });
  });

  it("filters by inclusive time range", async () => {
    const repository = createInMemoryDiagnosticLogRepository();
    await repository.append({
      occurredAt: new Date("2026-06-21T09:59:59.000Z"),
      source: "runtime",
      operation: "exam_attempt.enter",
      outcome: "success",
      message: "before",
      customerId: "customer-a",
    });
    await repository.append({
      occurredAt: new Date("2026-06-21T10:00:00.000Z"),
      source: "runtime",
      operation: "exam_attempt.enter",
      outcome: "success",
      message: "inside-start",
      customerId: "customer-a",
    });
    await repository.append({
      occurredAt: new Date("2026-06-21T10:15:00.000Z"),
      source: "runtime",
      operation: "exam_attempt.enter",
      outcome: "success",
      message: "inside-end",
      customerId: "customer-a",
    });
    await repository.append({
      occurredAt: new Date("2026-06-21T10:15:01.000Z"),
      source: "runtime",
      operation: "exam_attempt.enter",
      outcome: "success",
      message: "after",
      customerId: "customer-a",
    });

    const response = await handleGetDiagnosticLog(
      { diagnostics: repository, logger: noopLogger },
      {
        query: {
          from: "2026-06-21T10:00:00.000Z",
          to: "2026-06-21T10:15:00.000Z",
        },
        customerId: "customer-a",
      },
    );

    const entries = response.body.entries as Array<{ message: string }>;
    expect(entries.map((entry) => entry.message)).toEqual(["inside-end", "inside-start"]);
  });

  it("returns bounded results with pagination metadata", async () => {
    const repository = createInMemoryDiagnosticLogRepository();
    for (let index = 0; index < 3; index += 1) {
      await repository.append({
        occurredAt: new Date(`2026-06-21T10:00:0${index}.000Z`),
        source: "runtime",
        operation: "exam_attempt.enter",
        outcome: "success",
        message: `entry-${index}`,
        customerId: "customer-a",
      });
    }

    const response = await handleGetDiagnosticLog(
      { diagnostics: repository, logger: noopLogger },
      {
        query: {
          limit: "2",
          offset: "1",
        },
        customerId: "customer-a",
      },
    );

    const body = response.body as {
      entries: Array<{ message: string }>;
      page: { limit: number; offset: number; returned: number; hasMore: boolean; nextOffset: number | null };
    };
    expect(body.entries.map((entry) => entry.message)).toEqual(["entry-1", "entry-0"]);
    expect(body.page).toEqual({
      limit: 2,
      offset: 1,
      returned: 2,
      hasMore: false,
      nextOffset: null,
    });
  });

  it("reports hasMore at the max page size by probing the next row", async () => {
    const repository = createInMemoryDiagnosticLogRepository();
    for (let index = 0; index < 501; index += 1) {
      await repository.append({
        occurredAt: new Date(`2026-06-21T10:${String(Math.floor(index / 60)).padStart(2, "0")}:${String(index % 60).padStart(2, "0")}.000Z`),
        source: "runtime",
        operation: "exam_attempt.enter",
        outcome: "success",
        message: `entry-${index}`,
        customerId: "customer-a",
      });
    }

    const response = await handleGetDiagnosticLog(
      { diagnostics: repository, logger: noopLogger },
      {
        query: {
          limit: "500",
          offset: "0",
        },
        customerId: "customer-a",
      },
    );

    const body = response.body as {
      entries: Array<{ message: string }>;
      page: { limit: number; offset: number; returned: number; hasMore: boolean; nextOffset: number | null };
    };
    expect(body.entries).toHaveLength(500);
    expect(body.page).toEqual({
      limit: 500,
      offset: 0,
      returned: 500,
      hasMore: true,
      nextOffset: 500,
    });
  });

  it("ignores a client-supplied customerId and trusts the session scope", async () => {
    const repository = createInMemoryDiagnosticLogRepository();
    await repository.append({
      source: "auth",
      operation: "portal.login",
      outcome: "success",
      message: "a",
      customerId: "customer-a",
    });

    const response = await handleGetDiagnosticLog(
      { diagnostics: repository, logger: noopLogger },
      { query: { customerId: "customer-a" }, customerId: "customer-b" },
    );

    expect((response.body.entries as unknown[]).length).toBe(0);
  });
});
