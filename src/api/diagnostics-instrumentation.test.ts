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
import { handleGetDiagnosticLog } from "./admin";
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
  it("persists a redacted entry so no secret survives to the read model", async () => {
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
    expect(JSON.stringify(entry)).not.toContain("sk-live-supersecret");
    expect(entry.message).toBe("used [REDACTED]");
    expect(entry.details).toMatchObject({ apiKey: "[REDACTED]", note: "fine" });
  });
});

describe("handleGetDiagnosticLog", () => {
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
