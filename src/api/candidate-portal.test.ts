import { describe, expect, it, vi } from "vitest";
import { createPortalAuthenticator, hashPassword } from "@/auth";
import {
  createInMemoryPortalSessionStore,
  createInMemoryPortalUserStore,
} from "@/auth";
import { createInMemoryExamCatalogRepository } from "@/persistence/exam-catalog-repository";
import {
  createDraftExam,
  publishExam,
  type CreateDraftExamInput,
} from "@/domain/exam-catalog";
import type { Logger } from "@/observability/logger";
import type { PortalUserRepository } from "@/persistence/portal-auth-repository";
import {
  handleAdminCreateCandidate,
  handleCandidateSelfRegistration,
  handleGetCandidateExamCatalog,
} from "./candidate-portal";
import { handlePortalLogin } from "./portal-auth";

function makeLogger(): Logger {
  return { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
}

function makeExamInput(overrides: Partial<CreateDraftExamInput> = {}): CreateDraftExamInput {
  return {
    customerId: "customer-helios",
    title: "Helios CloudShare Fundamentals",
    description: "Hands-on certification exam.",
    timeLimitMinutes: 90,
    scoreRetrievalEnabled: false,
    projectId: "project-1",
    projectName: "Helios CX Project",
    blueprintId: "bp-1",
    blueprintName: "Helios Exam Blueprint",
    snapshotId: "snap-1",
    snapshotName: "Default Snapshot",
    allowedRegions: [{ id: "region-1", name: "EU West" }],
    policyId: "policy-1",
    policyName: "Standard Exam Policy",
    instructorId: "instructor-1",
    instructorName: "Helios Service Account",
    ...overrides,
  };
}

function createStubPortalUserRepository(): PortalUserRepository {
  const customers = new Map([
    ["helios-cx", { id: "customer-helios", slug: "helios-cx", name: "Helios CX" }],
    ["other-co", { id: "customer-other", slug: "other-co", name: "Other Co" }],
  ]);
  const users = new Map<string, Awaited<ReturnType<PortalUserRepository["findByEmail"]>>>();

  return {
    async findByEmail(email) {
      return users.get(email.trim().toLowerCase()) ?? null;
    },
    async findCustomerBySlug(slug) {
      return customers.get(slug) ?? null;
    },
    async createUser(input) {
      const record = {
        id: `user-${users.size + 1}`,
        customerId: input.customerId,
        email: input.email.trim().toLowerCase(),
        passwordHash: input.passwordHash,
        role: input.role,
      } as const;
      users.set(record.email, record);
      return record;
    },
    async upsertSeedUser(input) {
      const customer = customers.get(input.customerSlug) ?? {
        id: `customer-${customers.size + 1}`,
        slug: input.customerSlug,
        name: input.customerName,
      };
      customers.set(input.customerSlug, customer);
      const record = {
        id: `user-${users.size + 1}`,
        customerId: customer.id,
        email: input.email.trim().toLowerCase(),
        passwordHash: input.passwordHash,
        role: input.role,
      } as const;
      users.set(record.email, record);
      return record;
    },
  };
}

describe("candidate registration and provisioning", () => {
  it("self-registers a Candidate into Helios CX", async () => {
    const users = createStubPortalUserRepository();

    const response = await handleCandidateSelfRegistration(
      { users, logger: makeLogger() },
      {
        body: {
          email: "candidate@helioscx.demo",
          password: "correct-horse-battery-staple",
        },
      },
    );

    expect(response.status).toBe(201);
    expect(response.body).toEqual({
      candidate: {
        email: "candidate@helioscx.demo",
        role: "candidate",
        customerId: "customer-helios",
      },
    });
  });

  it("lets a Helios admin create a Candidate account for their customer", async () => {
    const users = createStubPortalUserRepository();

    const response = await handleAdminCreateCandidate(
      { users, logger: makeLogger() },
      {
        customerId: "customer-helios",
        body: {
          email: "provisioned@helioscx.demo",
          password: "correct-horse-battery-staple",
        },
      },
    );

    expect(response.status).toBe(201);
    expect(response.body).toEqual({
      candidate: {
        email: "provisioned@helioscx.demo",
        role: "candidate",
        customerId: "customer-helios",
      },
    });
  });
});

describe("candidate login", () => {
  it("logs a registered Candidate in through the shared portal auth flow", async () => {
    const portalAuth = createPortalAuthenticator({
      users: createInMemoryPortalUserStore([
        {
          id: "user-1",
          customerId: "customer-helios",
          email: "candidate@helioscx.demo",
          passwordHash: await hashPassword("correct-horse-battery-staple"),
          role: "candidate",
        },
      ]),
      sessions: createInMemoryPortalSessionStore(),
      now: () => 1_700_000_000_000,
      newSessionId: () => "portal-session-1",
    });

    const response = await handlePortalLogin(
      { portalAuth },
      {
        body: {
          email: "candidate@helioscx.demo",
          password: "correct-horse-battery-staple",
        },
      },
    );

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      session: {
        email: "candidate@helioscx.demo",
        role: "candidate",
        customerId: "customer-helios",
      },
    });
  });
});

describe("candidate exam catalog", () => {
  it("lists only published Exams for the Candidate's Customer", async () => {
    const repository = createInMemoryExamCatalogRepository();

    await createDraftExam(
      { repository, now: () => new Date("2026-06-14T12:00:00.000Z"), newId: () => "exam-draft" },
      makeExamInput({ title: "Draft Exam" }),
    );
    await createDraftExam(
      { repository, now: () => new Date("2026-06-14T12:05:00.000Z"), newId: () => "exam-published" },
      makeExamInput({ title: "Published Exam" }),
    );
    await publishExam(
      { repository, now: () => new Date("2026-06-14T12:10:00.000Z") },
      { customerId: "customer-helios", examId: "exam-published" },
    );
    await createDraftExam(
      { repository, now: () => new Date("2026-06-14T12:15:00.000Z"), newId: () => "exam-other" },
      makeExamInput({ customerId: "customer-other", title: "Other Customer Published Exam" }),
    );
    await publishExam(
      { repository, now: () => new Date("2026-06-14T12:20:00.000Z") },
      { customerId: "customer-other", examId: "exam-other" },
    );

    const response = await handleGetCandidateExamCatalog(
      { repository, logger: makeLogger() },
      { customerId: "customer-helios" },
    );

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      exams: [
        expect.objectContaining({
          id: "exam-published",
          title: "Published Exam",
          status: "published",
          customerId: "customer-helios",
        }),
      ],
    });
  });
});
