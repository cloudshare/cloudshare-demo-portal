import { describe, expect, it, vi } from "vitest";
import { createDiagnosticRecorder } from "@/domain/diagnostic-log";
import { createDraftCohortExamSession, markCohortExamSessionPublished } from "@/domain/cohort-exam-session";
import { createDraftExam, publishExam, type CreateDraftExamInput } from "@/domain/exam-catalog";
import type { CloudShareClientFactory } from "@/domain/cloudshare-connection";
import { CloudShareRateLimitError, CloudShareRequestError, CloudShareTransportError } from "@/integrations/cloudshare";
import { createInMemoryCohortExamSessionRepository } from "@/persistence/cohort-exam-session-repository";
import { createInMemoryDiagnosticLogRepository } from "@/persistence/diagnostic-log-repository";
import { createInMemoryExamCatalogRepository } from "@/persistence/exam-catalog-repository";
import type { Logger } from "@/observability/logger";
import {
  handleGetAdminCohortExamSessionDetail,
  type AdminCohortExamSessionAttemptRepository,
} from "./admin-cohort-exam-session-detail";

function makeLogger(): Logger {
  return { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
}

async function seedPublishedExam(
  exams: ReturnType<typeof createInMemoryExamCatalogRepository>,
  overrides: Partial<CreateDraftExamInput> = {},
) {
  const draft = await createDraftExam(
    {
      repository: exams,
      now: () => new Date("2026-07-04T10:00:00.000Z"),
      newId: () => "exam-1",
    },
    {
      customerId: "customer-1",
      title: "Helios CloudShare Fundamentals",
      description: "Hands-on exam",
      timeLimitMinutes: 240,
      storageLeaseMinutes: 2880,
      openPeriodMinutes: 720,
      scoreRetrievalEnabled: true,
      deliveryAvailability: "both",
      projectId: "project-1",
      projectName: "Helios CX Project",
      blueprintId: "bp-1",
      blueprintName: "Helios Exam Blueprint",
      snapshotId: "snap-1",
      snapshotName: "Default Snapshot",
      allowedRegions: [
        { id: "region-1", name: "EU West" },
        { id: "region-2", name: "US East" },
      ],
      policyId: "policy-1",
      policyName: "Standard Exam Policy",
      instructorId: "instructor-1",
      instructorName: "Helios Service Account",
      ...overrides,
    },
  );

  return publishExam(
    { repository: exams, now: () => new Date("2026-07-04T10:05:00.000Z") },
    { customerId: "customer-1", examId: draft.id },
  );
}

async function seedPublishedSession(
  sessions: ReturnType<typeof createInMemoryCohortExamSessionRepository>,
  examId = "exam-1",
) {
  const draft = await createDraftCohortExamSession(
    {
      repository: sessions,
      now: () => new Date("2026-07-04T11:00:00.000Z"),
      newId: () => "cohort-session-1",
    },
    {
      customerId: "customer-1",
      examId,
      name: "July Admin Cohort",
      admissionStartsAt: new Date("2026-07-05T09:00:00.000Z"),
      admissionEndsAt: new Date("2026-07-31T17:00:00.000Z"),
      capacity: 25,
    },
  );

  return markCohortExamSessionPublished(
    { repository: sessions, now: () => new Date("2026-07-04T12:00:00.000Z") },
    {
      session: { ...draft, status: "publishing", updatedAt: new Date("2026-07-04T11:30:00.000Z") },
      trainingId: "EXcohort-1",
      experienceId: "EXcohort-1",
      teamId: "TM-team-1",
    },
  );
}

describe("handleGetAdminCohortExamSessionDetail", () => {
  it("prefers explicit Certalis ExamAttempt correlation over email when matching CloudShare participants", async () => {
    const exams = createInMemoryExamCatalogRepository();
    const sessions = createInMemoryCohortExamSessionRepository();
    await seedPublishedExam(exams);
    await seedPublishedSession(sessions);

    const attempts: AdminCohortExamSessionAttemptRepository = {
      listBySessionId: vi.fn().mockResolvedValue([
        {
          id: "attempt-1",
          customerId: "customer-1",
          candidateId: "candidate-1",
          candidateEmail: "casey@helioscx.demo",
          candidateFirstName: "Casey",
          candidateLastName: "Rivera",
          examId: "exam-1",
          examTitle: "Helios CloudShare Fundamentals",
          status: "in_progress",
          scheduledFor: new Date("2026-07-06T10:00:00.000Z"),
          createdAt: new Date("2026-07-06T10:00:00.000Z"),
          trainingId: "EXcohort-1",
          experienceId: "EXcohort-1",
          environmentExternalId: "env-1",
          environmentId: "env-1",
          participantId: "student-1",
        },
        {
          id: "attempt-2",
          customerId: "customer-1",
          candidateId: "candidate-2",
          candidateEmail: "jordan@helioscx.demo",
          candidateFirstName: "Jordan",
          candidateLastName: "Lee",
          examId: "exam-1",
          examTitle: "Helios CloudShare Fundamentals",
          status: "ready",
          scheduledFor: new Date("2026-07-06T11:00:00.000Z"),
          createdAt: new Date("2026-07-06T11:00:00.000Z"),
          trainingId: "EXcohort-1",
          experienceId: "EXcohort-1",
          environmentExternalId: null,
          environmentId: null,
          participantId: "student-2",
        },
      ]),
    };

    const cloudshare: CloudShareClientFactory = {
      forConnection: () =>
        ({
          requestV4Detailed: vi.fn(async (spec: { schema: { parse(value: unknown): unknown } }) => ({
            data: spec.schema.parse({
              items: [
                {
                  email: "casey+renamed@helioscx.demo",
                  firstName: "Casey",
                  lastName: "Rivera",
                  envStatus: "Ready",
                  participationStatus: "inProgress",
                  envId: "env-1",
                  id: "student-1",
                  customProperties: {
                    certalisExamAttemptId: "attempt-1",
                    certalisCohortSessionId: "cohort-session-1",
                    certalisCandidateId: "candidate-1",
                  },
                },
                {
                  email: "jordan+renamed@helioscx.demo",
                  firstName: "Jordan",
                  lastName: "Lee",
                  envStatus: "Ready",
                  participationStatus: "inProgress",
                  envId: "env-2",
                  id: "student-2",
                  userCustomProperties: [
                    { key: "certalisExamAttemptId", value: "attempt-2" },
                    { key: "certalisCohortSessionId", value: "cohort-session-1" },
                  ],
                },
              ],
            }),
            host: "api.accelerate.cloudshare.com",
            integrationSurface: "cloudshare.v4.training.participant",
            request: {
              method: "GET",
              path: "/v4/trainings/EXcohort-1/students",
            },
            response: {
              status: 200,
              body: { items: [] },
            },
          })),
        }) as unknown as ReturnType<CloudShareClientFactory["forConnection"]>,
    };

    const response = await handleGetAdminCohortExamSessionDetail(
      {
        exams,
        sessions,
        attempts,
        connections: {
          findByCustomerId: vi.fn(async () => ({
            customerId: "customer-1",
            apiId: "api-id",
            apiKey: "secret-api-key",
            webhookSecret: "webhook-secret",
            webhookPathToken: "webhook-token",
            connectedAt: new Date("2026-07-01T00:00:00.000Z"),
            verifiedAt: new Date("2026-07-01T00:05:00.000Z"),
          })),
          save: vi.fn(),
          findByWebhookPathToken: vi.fn(),
          markVerified: vi.fn(),
        },
        cloudshare,
        logger: makeLogger(),
      },
      {
        customerId: "customer-1",
        examId: "exam-1",
        sessionId: "cohort-session-1",
      },
    );

    expect(response.status).toBe(200);
    if (!("monitoring" in response.body)) {
      throw new Error("Expected monitoring payload");
    }
    expect(response.body.monitoring.cloudShareParticipants.participants).toMatchObject([
      {
        email: "casey+renamed@helioscx.demo",
        matchedExamAttemptId: "attempt-1",
        diagnosticFilters: {
          examAttemptId: "attempt-1",
          candidateEmail: "casey+renamed@helioscx.demo",
          externalId: "env-1",
        },
        summaryContributions: ["active", "in_progress"],
      },
      {
        email: "jordan+renamed@helioscx.demo",
        matchedExamAttemptId: "attempt-2",
        diagnosticFilters: {
          examAttemptId: "attempt-2",
          candidateEmail: "jordan+renamed@helioscx.demo",
          externalId: "env-2",
        },
        summaryContributions: ["active", "in_progress"],
      },
    ]);
    expect(response.body.monitoring.summary).toEqual({
      activeCount: 2,
      inProgressCount: 2,
      completedCount: 0,
      problemCount: 0,
      portalAttemptCount: 2,
      cloudShareParticipantCount: 2,
      derivedFrom: "portal_and_cloudshare",
    });
  });

  it("falls back to email matching when explicit Certalis participant correlation is absent", async () => {
    const exams = createInMemoryExamCatalogRepository();
    const sessions = createInMemoryCohortExamSessionRepository();
    await seedPublishedExam(exams);
    await seedPublishedSession(sessions);

    const attempts: AdminCohortExamSessionAttemptRepository = {
      listBySessionId: vi.fn().mockResolvedValue([
        {
          id: "attempt-1",
          customerId: "customer-1",
          candidateId: "candidate-1",
          candidateEmail: "casey@helioscx.demo",
          candidateFirstName: "Casey",
          candidateLastName: "Rivera",
          examId: "exam-1",
          examTitle: "Helios CloudShare Fundamentals",
          status: "in_progress",
          scheduledFor: new Date("2026-07-06T10:00:00.000Z"),
          createdAt: new Date("2026-07-06T10:00:00.000Z"),
          trainingId: "EXcohort-1",
          experienceId: "EXcohort-1",
          environmentExternalId: "env-1",
          environmentId: "env-1",
          participantId: "student-1",
        },
      ]),
    };

    const cloudshare: CloudShareClientFactory = {
      forConnection: () =>
        ({
          requestV4Detailed: vi.fn(async (spec: { schema: { parse(value: unknown): unknown } }) => ({
            data: spec.schema.parse({
              items: [
                {
                  email: "casey@helioscx.demo",
                  firstName: "Casey",
                  lastName: "Rivera",
                  envStatus: "Ready",
                  participationStatus: "inProgress",
                  envId: "env-1",
                  id: "student-1",
                },
              ],
            }),
            host: "api.accelerate.cloudshare.com",
            integrationSurface: "cloudshare.v4.training.participant",
            request: {
              method: "GET",
              path: "/v4/trainings/EXcohort-1/students",
            },
            response: {
              status: 200,
              body: { items: [] },
            },
          })),
        }) as unknown as ReturnType<CloudShareClientFactory["forConnection"]>,
    };

    const response = await handleGetAdminCohortExamSessionDetail(
      {
        exams,
        sessions,
        attempts,
        connections: {
          findByCustomerId: vi.fn(async () => ({
            customerId: "customer-1",
            apiId: "api-id",
            apiKey: "secret-api-key",
            webhookSecret: "webhook-secret",
            webhookPathToken: "webhook-token",
            connectedAt: new Date("2026-07-01T00:00:00.000Z"),
            verifiedAt: new Date("2026-07-01T00:05:00.000Z"),
          })),
          save: vi.fn(),
          findByWebhookPathToken: vi.fn(),
          markVerified: vi.fn(),
        },
        cloudshare,
        logger: makeLogger(),
      },
      {
        customerId: "customer-1",
        examId: "exam-1",
        sessionId: "cohort-session-1",
      },
    );

    expect(response.status).toBe(200);
    if (!("monitoring" in response.body)) {
      throw new Error("Expected monitoring payload");
    }
    expect(response.body.monitoring.cloudShareParticipants.participants).toMatchObject([
      {
        email: "casey@helioscx.demo",
        matchedExamAttemptId: "attempt-1",
      },
    ]);
    expect(response.body.monitoring.summary).toEqual({
      activeCount: 1,
      inProgressCount: 1,
      completedCount: 0,
      problemCount: 0,
      portalAttemptCount: 1,
      cloudShareParticipantCount: 1,
      derivedFrom: "portal_and_cloudshare",
    });
  });

  it("returns portal attempts, CloudShare participants, derived counts, and diagnostic filters", async () => {
    const exams = createInMemoryExamCatalogRepository();
    const sessions = createInMemoryCohortExamSessionRepository();
    const diagnosticsRepository = createInMemoryDiagnosticLogRepository();
    const diagnostics = createDiagnosticRecorder({
      repository: diagnosticsRepository,
      secrets: ["secret-api-key"],
    });
    await seedPublishedExam(exams);
    await seedPublishedSession(sessions);

    const attempts: AdminCohortExamSessionAttemptRepository = {
      listBySessionId: vi.fn().mockResolvedValue([
        {
          id: "attempt-1",
          customerId: "customer-1",
          candidateId: "candidate-1",
          candidateEmail: "casey@helioscx.demo",
          candidateFirstName: "Casey",
          candidateLastName: "Rivera",
          examId: "exam-1",
          examTitle: "Helios CloudShare Fundamentals",
          status: "in_progress",
          scheduledFor: new Date("2026-07-06T10:00:00.000Z"),
          createdAt: new Date("2026-07-06T10:00:00.000Z"),
          trainingId: "EXcohort-1",
          experienceId: "EXcohort-1",
          environmentExternalId: "env-1",
          environmentId: "env-1",
          participantId: "student-1",
        },
        {
          id: "attempt-2",
          customerId: "customer-1",
          candidateId: "candidate-2",
          candidateEmail: "jordan@helioscx.demo",
          candidateFirstName: "Jordan",
          candidateLastName: "Lee",
          examId: "exam-1",
          examTitle: "Helios CloudShare Fundamentals",
          status: "completed",
          scheduledFor: new Date("2026-07-06T08:00:00.000Z"),
          createdAt: new Date("2026-07-06T08:00:00.000Z"),
          trainingId: "EXcohort-1",
          experienceId: "EXcohort-1",
          environmentExternalId: "env-2",
          environmentId: "env-2",
          participantId: "student-2",
        },
      ]),
    };

    const requestV4Detailed = vi.fn(
      async (spec: { method: string; path: string; schema: { parse(value: unknown): unknown } }) => {
        if (spec.path === "/guided-journey/progress/EXcohort-1") {
          return {
            data: spec.schema.parse({
              avgExploredRate: 0.45,
              avgInProgressRate: 0.2,
              avgNotStartedRate: 0.1,
              avgPassedRate: 0.2,
              avgFailedRate: 0.05,
              avgNotInitiatedRate: 0,
              aggSectionStatuses: [
                {
                  number: 0,
                  name: "Check pfSense WAN Interface",
                  status: "explored",
                  avgExploredRate: 0.6,
                  avgInProgressRate: 0.1,
                  avgNotStartedRate: 0.3,
                  avgPassedRate: 0.4,
                  avgFailedRate: 0,
                  avgNotInitiatedRate: 0,
                  avgTimeSpent: 338.24936349999996,
                },
              ],
            }),
            host: "api.accelerate.cloudshare.com",
            integrationSurface: "cloudshare.v4.guided_journey.progress.aggregate",
            request: {
              method: spec.method,
              path: spec.path,
              headers: { authorization: "Bearer secret-api-key" },
            },
            response: {
              status: 200,
              headers: { "content-type": "application/json" },
              body: {
                avgExploredRate: 0.45,
                avgInProgressRate: 0.2,
                avgNotStartedRate: 0.1,
                avgPassedRate: 0.2,
                avgFailedRate: 0.05,
                avgNotInitiatedRate: 0,
                aggSectionStatuses: [
                  {
                    number: 0,
                    name: "Check pfSense WAN Interface",
                    status: "explored",
                  },
                ],
              },
            },
          };
        }

        return {
          data: spec.schema.parse({
            items: [
              {
                email: "casey@helioscx.demo",
                firstName: "Casey",
                lastName: "Rivera",
                name: "Casey Rivera",
                envId: "env-1",
                envStatus: "Ready",
                participationStatus: "inProgress",
                firstJoined: "2026-07-06T10:15:00.000Z",
                id: "student-1",
              },
              {
                email: "jordan@helioscx.demo",
                firstName: "Jordan",
                lastName: "Lee",
                name: "Jordan Lee",
                envId: "env-2",
                envStatus: "Archived",
                participationStatus: "completed",
                firstJoined: "2026-07-06T08:10:00.000Z",
                id: "student-2",
              },
              {
                email: "taylor@helioscx.demo",
                firstName: "Taylor",
                lastName: "Ng",
                name: "Taylor Ng",
                envId: "env-3",
                envStatus: "ProvisioningFailed",
                participationStatus: "inProgress",
                firstJoined: "2026-07-06T11:00:00.000Z",
                id: "student-3",
              },
            ],
          }),
          host: "api.accelerate.cloudshare.com",
          integrationSurface: "cloudshare.v4.training.participant",
          request: {
            method: spec.method,
            path: "/v4" + spec.path,
            headers: { authorization: "Bearer secret-api-key" },
          },
          response: {
            status: 200,
            headers: { "content-type": "application/json" },
            body: {
              items: [
                {
                  email: "casey@helioscx.demo",
                  envId: "env-1",
                  envStatus: "Ready",
                },
              ],
            },
          },
        };
      },
    );
    const cloudshare: CloudShareClientFactory = {
      forConnection: () =>
        ({
          requestV4Detailed,
        }) as unknown as ReturnType<CloudShareClientFactory["forConnection"]>,
    };

    const response = await handleGetAdminCohortExamSessionDetail(
      {
        exams,
        sessions,
        attempts,
        diagnostics,
        connections: {
          findByCustomerId: vi.fn(async () => ({
            customerId: "customer-1",
            apiId: "api-id",
            apiKey: "secret-api-key",
            webhookSecret: "webhook-secret",
            webhookPathToken: "webhook-token",
            connectedAt: new Date("2026-07-01T00:00:00.000Z"),
            verifiedAt: new Date("2026-07-01T00:05:00.000Z"),
          })),
          save: vi.fn(),
          findByWebhookPathToken: vi.fn(),
          markVerified: vi.fn(),
        },
        cloudshare,
        logger: makeLogger(),
        newCorrelationId: () => "corr-session-detail-1",
      },
      {
        customerId: "customer-1",
        examId: "exam-1",
        sessionId: "cohort-session-1",
      },
    );

    expect(response.status).toBe(200);
    if (!("monitoring" in response.body)) {
      throw new Error("Expected monitoring payload");
    }
    expect(response.body.monitoring.summary).toEqual({
      activeCount: 1,
      inProgressCount: 1,
      completedCount: 1,
      problemCount: 1,
      portalAttemptCount: 2,
      cloudShareParticipantCount: 3,
      derivedFrom: "portal_and_cloudshare",
    });
    expect(response.body.monitoring.portalAttempts).toMatchObject([
      {
        id: "attempt-1",
        candidateName: "Casey Rivera",
        status: "in_progress",
        problemReasons: [],
        diagnosticFilters: { examAttemptId: "attempt-1" },
      },
      {
        id: "attempt-2",
        candidateName: "Jordan Lee",
        status: "completed",
        problemReasons: [],
        diagnosticFilters: { examAttemptId: "attempt-2" },
      },
    ]);
    expect(response.body.monitoring.cloudShareParticipants).toMatchObject({
      status: "available",
      readError: null,
      correlationId: "corr-session-detail-1",
      participants: [
        {
          email: "casey@helioscx.demo",
          displayName: "Casey Rivera",
          participationStatus: "inProgress",
          environmentStatus: "Ready",
          matchedExamAttemptId: "attempt-1",
          diagnosticFilters: {
            examAttemptId: "attempt-1",
            candidateEmail: "casey@helioscx.demo",
            externalId: "env-1",
          },
          problemReasons: [],
        },
        {
          email: "jordan@helioscx.demo",
          matchedExamAttemptId: "attempt-2",
          problemReasons: [],
        },
        {
          email: "taylor@helioscx.demo",
          matchedExamAttemptId: null,
          problemReasons: [
            "CloudShare participant has no matching portal attempt.",
            "CloudShare environment is in a non-terminal problem state.",
          ],
        },
      ],
    });
    expect(response.body.monitoring.guidedJourneyAggregate).toEqual({
      status: "available",
      experienceId: "EXcohort-1",
      readError: null,
      correlationId: "corr-session-detail-1",
      progress: {
        avgExploredRate: 0.45,
        avgInProgressRate: 0.2,
        avgNotStartedRate: 0.1,
        avgPassedRate: 0.2,
        avgFailedRate: 0.05,
        avgNotInitiatedRate: 0,
        aggSectionStatuses: [
          {
            sectionNumber: 0,
            title: "Check pfSense WAN Interface",
            status: "explored",
            avgExploredRate: 0.6,
            avgInProgressRate: 0.1,
            avgNotStartedRate: 0.3,
            avgPassedRate: 0.4,
            avgFailedRate: 0,
            avgNotInitiatedRate: 0,
            avgTimeSpentSeconds: 338.24936349999996,
          },
        ],
      },
    });
    expect(response.body.monitoring.diagnostics).toEqual({
      session: {
        examId: "exam-1",
        externalId: "EXcohort-1",
      },
      cloudShareRead: {
        correlationId: "corr-session-detail-1",
        operation: "cohort_exam_session.monitor.read_participants",
      },
      guidedJourneyAggregateRead: {
        correlationId: "corr-session-detail-1",
        operation: "cohort_exam_session.guided_journey_aggregate.read",
      },
    });

    const [entry] = await diagnosticsRepository.query({
      customerId: "customer-1",
      examId: "exam-1",
      operation: "cohort_exam_session.monitor.read_participants",
    });
    expect(entry).toMatchObject({
      outcome: "success",
      message: "Fetched CloudShare participants for session monitoring",
      correlationId: "corr-session-detail-1",
      externalIds: {
        trainingId: "EXcohort-1",
        experienceId: "EXcohort-1",
      },
      request: {
        method: "GET",
        path: "/v4/trainings/EXcohort-1/students",
        headers: { authorization: "[REDACTED]" },
      },
      response: {
        status: 200,
      },
      details: {
        integrationSurface: "cloudshare.v4.training.participant",
        participantCount: 3,
      },
    });

    const [aggregateEntry] = await diagnosticsRepository.query({
      customerId: "customer-1",
      examId: "exam-1",
      operation: "cohort_exam_session.guided_journey_aggregate.read",
    });
    expect(aggregateEntry).toMatchObject({
      outcome: "success",
      correlationId: "corr-session-detail-1",
      externalIds: {
        experienceId: "EXcohort-1",
      },
      request: {
        method: "GET",
        path: "/guided-journey/progress/EXcohort-1",
      },
      details: {
        integrationSurface: "cloudshare.v4.guided_journey.progress.aggregate",
        sectionCount: 1,
      },
    });
  });

  it("counts abnormal CloudShare environment states as problems instead of in-progress", async () => {
    const exams = createInMemoryExamCatalogRepository();
    const sessions = createInMemoryCohortExamSessionRepository();
    await seedPublishedExam(exams);
    await seedPublishedSession(sessions);

    const attempts: AdminCohortExamSessionAttemptRepository = {
      listBySessionId: vi.fn().mockResolvedValue([]),
    };

    const cloudshare: CloudShareClientFactory = {
      forConnection: () =>
        ({
          requestV4Detailed: vi.fn(
            async (spec: { schema: { parse(value: unknown): unknown } }) => ({
              data: spec.schema.parse({
                items: [
                  {
                    email: "taylor@helioscx.demo",
                    firstName: "Taylor",
                    lastName: "Ng",
                    envId: "env-3",
                    envStatus: "ProvisioningFailed",
                    participationStatus: "inProgress",
                    id: "student-3",
                  },
                ],
              }),
              host: "api.accelerate.cloudshare.com",
              integrationSurface: "cloudshare.v4.training.participant",
              request: {
                method: "GET",
                path: "/v4/trainings/EXcohort-1/students",
                headers: { authorization: "Bearer secret-api-key" },
              },
              response: {
                status: 200,
                headers: { "content-type": "application/json" },
                body: { items: [{ email: "taylor@helioscx.demo", envStatus: "ProvisioningFailed" }] },
              },
            }),
          ),
        }) as unknown as ReturnType<CloudShareClientFactory["forConnection"]>,
    };

    const response = await handleGetAdminCohortExamSessionDetail(
      {
        exams,
        sessions,
        attempts,
        connections: {
          findByCustomerId: vi.fn(async () => ({
            customerId: "customer-1",
            apiId: "api-id",
            apiKey: "secret-api-key",
            webhookSecret: "webhook-secret",
            webhookPathToken: "webhook-token",
            connectedAt: new Date("2026-07-01T00:00:00.000Z"),
            verifiedAt: new Date("2026-07-01T00:05:00.000Z"),
          })),
          save: vi.fn(),
          findByWebhookPathToken: vi.fn(),
          markVerified: vi.fn(),
        },
        cloudshare,
        logger: makeLogger(),
      },
      {
        customerId: "customer-1",
        examId: "exam-1",
        sessionId: "cohort-session-1",
      },
    );

    expect(response.status).toBe(200);
    if (!("monitoring" in response.body)) {
      throw new Error("Expected monitoring payload");
    }
    expect(response.body.monitoring.summary).toEqual({
      activeCount: 0,
      inProgressCount: 0,
      completedCount: 0,
      problemCount: 1,
      portalAttemptCount: 0,
      cloudShareParticipantCount: 1,
      derivedFrom: "portal_and_cloudshare",
    });
    expect(response.body.monitoring.cloudShareParticipants.participants).toMatchObject([
      {
        email: "taylor@helioscx.demo",
        problemReasons: [
          "CloudShare participant has no matching portal attempt.",
          "CloudShare environment is in a non-terminal problem state.",
        ],
      },
    ]);
  });

  it("explains portal and CloudShare state mismatches directly on the affected matched rows", async () => {
    const exams = createInMemoryExamCatalogRepository();
    const sessions = createInMemoryCohortExamSessionRepository();
    await seedPublishedExam(exams);
    await seedPublishedSession(sessions);

    const attempts: AdminCohortExamSessionAttemptRepository = {
      listBySessionId: vi.fn().mockResolvedValue([
        {
          id: "attempt-1",
          customerId: "customer-1",
          candidateId: "candidate-1",
          candidateEmail: "casey@helioscx.demo",
          candidateFirstName: "Casey",
          candidateLastName: "Rivera",
          examId: "exam-1",
          examTitle: "Helios CloudShare Fundamentals",
          status: "suspended",
          scheduledFor: new Date("2026-07-06T10:00:00.000Z"),
          createdAt: new Date("2026-07-06T10:00:00.000Z"),
          trainingId: "EXcohort-1",
          experienceId: "EXcohort-1",
          environmentExternalId: "env-1",
          environmentId: "env-1",
          participantId: "student-1",
        },
      ]),
    };

    const cloudshare: CloudShareClientFactory = {
      forConnection: () =>
        ({
          requestV4Detailed: vi.fn(
            async (spec: { schema: { parse(value: unknown): unknown } }) => ({
              data: spec.schema.parse({
                items: [
                  {
                    email: "casey@helioscx.demo",
                    firstName: "Casey",
                    lastName: "Rivera",
                    envId: "env-1",
                    envStatus: "Running",
                    participationStatus: "inProgress",
                    id: "student-1",
                    customProperties: {
                      certalisExamAttemptId: "attempt-1",
                      certalisCohortSessionId: "cohort-session-1",
                      certalisCandidateId: "candidate-1",
                    },
                  },
                ],
              }),
              host: "api.accelerate.cloudshare.com",
              integrationSurface: "cloudshare.v4.training.participant",
              request: {
                method: "GET",
                path: "/v4/trainings/EXcohort-1/students",
              },
              response: {
                status: 200,
                body: { items: [] },
              },
            }),
          ),
        }) as unknown as ReturnType<CloudShareClientFactory["forConnection"]>,
    };

    const response = await handleGetAdminCohortExamSessionDetail(
      {
        exams,
        sessions,
        attempts,
        connections: {
          findByCustomerId: vi.fn(async () => ({
            customerId: "customer-1",
            apiId: "api-id",
            apiKey: "secret-api-key",
            webhookSecret: "webhook-secret",
            webhookPathToken: "webhook-token",
            connectedAt: new Date("2026-07-01T00:00:00.000Z"),
            verifiedAt: new Date("2026-07-01T00:05:00.000Z"),
          })),
          save: vi.fn(),
          findByWebhookPathToken: vi.fn(),
          markVerified: vi.fn(),
        },
        cloudshare,
        logger: makeLogger(),
      },
      {
        customerId: "customer-1",
        examId: "exam-1",
        sessionId: "cohort-session-1",
      },
    );

    expect(response.status).toBe(200);
    if (!("monitoring" in response.body)) {
      throw new Error("Expected monitoring payload");
    }
    expect(response.body.monitoring.summary.problemCount).toBe(1);
    expect(response.body.monitoring.portalAttempts).toMatchObject([
      {
        id: "attempt-1",
        problemReasons: ["Portal suspended; CloudShare environment is running."],
      },
    ]);
    expect(response.body.monitoring.cloudShareParticipants.participants).toMatchObject([
      {
        email: "casey@helioscx.demo",
        matchedExamAttemptId: "attempt-1",
        problemReasons: ["Portal suspended; CloudShare environment is running."],
      },
    ]);
  });

  it("does not request aggregate Guided Journey progress when score retrieval is disabled on the parent Exam", async () => {
    const exams = createInMemoryExamCatalogRepository();
    const sessions = createInMemoryCohortExamSessionRepository();
    await seedPublishedExam(exams, { scoreRetrievalEnabled: false });
    await seedPublishedSession(sessions);

    const attempts: AdminCohortExamSessionAttemptRepository = {
      listBySessionId: vi.fn().mockResolvedValue([]),
    };

    const requestV4 = vi.fn();
    const cloudshare: CloudShareClientFactory = {
      forConnection: () =>
        ({
          requestV4Detailed: vi.fn(async (spec: { schema: { parse(value: unknown): unknown } }) => ({
            data: spec.schema.parse({ items: [] }),
            host: "api.accelerate.cloudshare.com",
            integrationSurface: "cloudshare.v4.training.participant",
            request: { method: "GET", path: "/v4/trainings/EXcohort-1/students" },
            response: { status: 200, body: { items: [] } },
          })),
          requestV4,
        }) as unknown as ReturnType<CloudShareClientFactory["forConnection"]>,
    };

    const response = await handleGetAdminCohortExamSessionDetail(
      {
        exams,
        sessions,
        attempts,
        connections: {
          findByCustomerId: vi.fn(async () => ({
            customerId: "customer-1",
            apiId: "api-id",
            apiKey: "secret-api-key",
            webhookSecret: "webhook-secret",
            webhookPathToken: "webhook-token",
            connectedAt: new Date("2026-07-01T00:00:00.000Z"),
            verifiedAt: new Date("2026-07-01T00:05:00.000Z"),
          })),
          save: vi.fn(),
          findByWebhookPathToken: vi.fn(),
          markVerified: vi.fn(),
        },
        cloudshare,
        logger: makeLogger(),
      },
      {
        customerId: "customer-1",
        examId: "exam-1",
        sessionId: "cohort-session-1",
      },
    );

    expect(response.status).toBe(200);
    if (!("monitoring" in response.body)) {
      throw new Error("Expected monitoring payload");
    }
    expect(response.body.monitoring.guidedJourneyAggregate).toEqual({
      status: "disabled",
      experienceId: "EXcohort-1",
      readError: null,
      correlationId: null,
      progress: null,
    });
    expect(response.body.monitoring.diagnostics.guidedJourneyAggregateRead).toBeUndefined();
    expect(requestV4).not.toHaveBeenCalled();
  });

  it("returns degraded monitoring state and records diagnostics when the CloudShare participant read fails", async () => {
    const exams = createInMemoryExamCatalogRepository();
    const sessions = createInMemoryCohortExamSessionRepository();
    const diagnosticsRepository = createInMemoryDiagnosticLogRepository();
    const diagnostics = createDiagnosticRecorder({
      repository: diagnosticsRepository,
      secrets: ["secret-api-key"],
    });
    await seedPublishedExam(exams);
    await seedPublishedSession(sessions);

    const attempts: AdminCohortExamSessionAttemptRepository = {
      listBySessionId: vi.fn().mockResolvedValue([
        {
          id: "attempt-1",
          customerId: "customer-1",
          candidateId: "candidate-1",
          candidateEmail: "casey@helioscx.demo",
          candidateFirstName: "Casey",
          candidateLastName: "Rivera",
          examId: "exam-1",
          examTitle: "Helios CloudShare Fundamentals",
          status: "ready",
          scheduledFor: new Date("2026-07-06T10:00:00.000Z"),
          createdAt: new Date("2026-07-06T10:00:00.000Z"),
          trainingId: "EXcohort-1",
          experienceId: "EXcohort-1",
          environmentExternalId: null,
          environmentId: null,
          participantId: null,
        },
      ]),
    };

    const cloudshare: CloudShareClientFactory = {
      forConnection: () =>
        ({
          requestV4Detailed: vi.fn(async () => {
            throw new CloudShareTransportError("CloudShare was unreachable", {
              method: "GET",
              path: "/v4/trainings/EXcohort-1/students",
              integrationSurface: "cloudshare.v4.training.participant",
              requestHeaders: { authorization: "Bearer secret-api-key" },
              cause: "ECONNRESET",
            });
          }),
        }) as unknown as ReturnType<CloudShareClientFactory["forConnection"]>,
    };

    const response = await handleGetAdminCohortExamSessionDetail(
      {
        exams,
        sessions,
        attempts,
        diagnostics,
        connections: {
          findByCustomerId: vi.fn(async () => ({
            customerId: "customer-1",
            apiId: "api-id",
            apiKey: "secret-api-key",
            webhookSecret: "webhook-secret",
            webhookPathToken: "webhook-token",
            connectedAt: new Date("2026-07-01T00:00:00.000Z"),
            verifiedAt: new Date("2026-07-01T00:05:00.000Z"),
          })),
          save: vi.fn(),
          findByWebhookPathToken: vi.fn(),
          markVerified: vi.fn(),
        },
        cloudshare,
        logger: makeLogger(),
        newCorrelationId: () => "corr-session-detail-failure",
      },
      {
        customerId: "customer-1",
        examId: "exam-1",
        sessionId: "cohort-session-1",
      },
    );

    expect(response.status).toBe(200);
    if (!("monitoring" in response.body)) {
      throw new Error("Expected monitoring payload");
    }
    expect(response.body.monitoring.summary.problemCount).toBe(2);
    expect(response.body.monitoring.cloudShareParticipants).toMatchObject({
      status: "unavailable",
      participants: [],
      readError: "CloudShare participant read failed for this Cohort Exam Session.",
      correlationId: "corr-session-detail-failure",
    });

    const [entry] = await diagnosticsRepository.query({
      customerId: "customer-1",
      examId: "exam-1",
      operation: "cohort_exam_session.monitor.read_participants",
      outcome: "failure",
    });
    expect(entry).toMatchObject({
      correlationId: "corr-session-detail-failure",
      request: {
        method: "GET",
        path: "/v4/trainings/EXcohort-1/students",
        headers: { authorization: "[REDACTED]" },
      },
      response: null,
      details: {
        integrationSurface: "cloudshare.v4.training.participant",
        failureMode: "transport",
        cause: "ECONNRESET",
      },
    });
  });

  it("returns an unavailable aggregate Guided Journey state and records a supportable diagnostic when no aggregate data is available", async () => {
    const exams = createInMemoryExamCatalogRepository();
    const sessions = createInMemoryCohortExamSessionRepository();
    const diagnosticsRepository = createInMemoryDiagnosticLogRepository();
    const diagnostics = createDiagnosticRecorder({
      repository: diagnosticsRepository,
      secrets: ["secret-api-key"],
    });
    await seedPublishedExam(exams);
    await seedPublishedSession(sessions);

    const attempts: AdminCohortExamSessionAttemptRepository = {
      listBySessionId: vi.fn().mockResolvedValue([]),
    };

    const cloudshare: CloudShareClientFactory = {
      forConnection: () =>
        ({
          requestV4Detailed: vi.fn(async (spec: { path: string; schema: { parse(value: unknown): unknown } }) => {
            if (spec.path === "/guided-journey/progress/EXcohort-1") {
              throw new CloudShareRequestError("not found", 404, {
                method: "GET",
                path: "/guided-journey/progress/EXcohort-1",
                requestHeaders: { authorization: "Bearer secret-api-key" },
                responseHeaders: { "content-type": "application/json" },
              });
            }

            return {
              data: spec.schema.parse({ items: [] }),
              host: "api.accelerate.cloudshare.com",
              integrationSurface: "cloudshare.v4.training.participant",
              request: {
                method: "GET",
                path: "/v4/trainings/EXcohort-1/students",
                headers: { authorization: "Bearer secret-api-key" },
              },
              response: { status: 200, body: { items: [] } },
            };
          }),
        }) as unknown as ReturnType<CloudShareClientFactory["forConnection"]>,
    };

    const response = await handleGetAdminCohortExamSessionDetail(
      {
        exams,
        sessions,
        attempts,
        diagnostics,
        connections: {
          findByCustomerId: vi.fn(async () => ({
            customerId: "customer-1",
            apiId: "api-id",
            apiKey: "secret-api-key",
            webhookSecret: "webhook-secret",
            webhookPathToken: "webhook-token",
            connectedAt: new Date("2026-07-01T00:00:00.000Z"),
            verifiedAt: new Date("2026-07-01T00:05:00.000Z"),
          })),
          save: vi.fn(),
          findByWebhookPathToken: vi.fn(),
          markVerified: vi.fn(),
        },
        cloudshare,
        logger: makeLogger(),
        newCorrelationId: () => "corr-session-detail-aggregate-unavailable",
      },
      {
        customerId: "customer-1",
        examId: "exam-1",
        sessionId: "cohort-session-1",
      },
    );

    expect(response.status).toBe(200);
    if (!("monitoring" in response.body)) {
      throw new Error("Expected monitoring payload");
    }
    expect(response.body.monitoring.guidedJourneyAggregate).toEqual({
      status: "unavailable",
      experienceId: "EXcohort-1",
      readError: "Aggregate Guided Journey progress is unavailable for this Cohort Exam Session / CloudShare Experience.",
      correlationId: "corr-session-detail-aggregate-unavailable",
      progress: null,
    });

    const [entry] = await diagnosticsRepository.query({
      customerId: "customer-1",
      examId: "exam-1",
      operation: "cohort_exam_session.guided_journey_aggregate.read",
      outcome: "failure",
    });
    expect(entry).toMatchObject({
      correlationId: "corr-session-detail-aggregate-unavailable",
      request: {
        method: "GET",
        path: "/guided-journey/progress/EXcohort-1",
        headers: { authorization: "[REDACTED]" },
      },
      response: {
        status: 404,
        body: null,
      },
      details: {
        integrationSurface: "cloudshare.v4.guided_journey.progress.aggregate",
        failureMode: "not_available",
      },
    });
  });

  it("returns an unavailable aggregate Guided Journey state and logs CloudShare failures with redacted evidence", async () => {
    const exams = createInMemoryExamCatalogRepository();
    const sessions = createInMemoryCohortExamSessionRepository();
    const diagnosticsRepository = createInMemoryDiagnosticLogRepository();
    const diagnostics = createDiagnosticRecorder({
      repository: diagnosticsRepository,
      secrets: ["secret-api-key"],
    });
    await seedPublishedExam(exams);
    await seedPublishedSession(sessions);

    const attempts: AdminCohortExamSessionAttemptRepository = {
      listBySessionId: vi.fn().mockResolvedValue([]),
    };

    const cloudshare: CloudShareClientFactory = {
      forConnection: () =>
        ({
          requestV4Detailed: vi.fn(async (spec: { path: string; schema: { parse(value: unknown): unknown } }) => {
            if (spec.path === "/guided-journey/progress/EXcohort-1") {
              throw new CloudShareTransportError("CloudShare was unreachable", {
                method: "GET",
                path: "/guided-journey/progress/EXcohort-1",
                integrationSurface: "cloudshare.v4.guided_journey.progress.aggregate",
                requestHeaders: { authorization: "Bearer secret-api-key" },
                cause: "ECONNRESET",
              });
            }

            return {
              data: spec.schema.parse({ items: [] }),
              host: "api.accelerate.cloudshare.com",
              integrationSurface: "cloudshare.v4.training.participant",
              request: { method: "GET", path: "/v4/trainings/EXcohort-1/students" },
              response: { status: 200, body: { items: [] } },
            };
          }),
        }) as unknown as ReturnType<CloudShareClientFactory["forConnection"]>,
    };

    const response = await handleGetAdminCohortExamSessionDetail(
      {
        exams,
        sessions,
        attempts,
        diagnostics,
        connections: {
          findByCustomerId: vi.fn(async () => ({
            customerId: "customer-1",
            apiId: "api-id",
            apiKey: "secret-api-key",
            webhookSecret: "webhook-secret",
            webhookPathToken: "webhook-token",
            connectedAt: new Date("2026-07-01T00:00:00.000Z"),
            verifiedAt: new Date("2026-07-01T00:05:00.000Z"),
          })),
          save: vi.fn(),
          findByWebhookPathToken: vi.fn(),
          markVerified: vi.fn(),
        },
        cloudshare,
        logger: makeLogger(),
        newCorrelationId: () => "corr-session-detail-aggregate-failure",
      },
      {
        customerId: "customer-1",
        examId: "exam-1",
        sessionId: "cohort-session-1",
      },
    );

    expect(response.status).toBe(200);
    if (!("monitoring" in response.body)) {
      throw new Error("Expected monitoring payload");
    }
    expect(response.body.monitoring.guidedJourneyAggregate.status).toBe("unavailable");

    const [entry] = await diagnosticsRepository.query({
      customerId: "customer-1",
      examId: "exam-1",
      operation: "cohort_exam_session.guided_journey_aggregate.read",
      outcome: "failure",
    });
    expect(entry).toMatchObject({
      correlationId: "corr-session-detail-aggregate-failure",
      request: {
        method: "GET",
        path: "/guided-journey/progress/EXcohort-1",
        headers: { authorization: "[REDACTED]" },
      },
      response: null,
      details: {
        integrationSurface: "cloudshare.v4.guided_journey.progress.aggregate",
        failureMode: "transport",
        cause: "ECONNRESET",
        experienceId: "EXcohort-1",
      },
    });
  });

  it("records rate-limit diagnostics when aggregate Guided Journey progress is throttled", async () => {
    const exams = createInMemoryExamCatalogRepository();
    const sessions = createInMemoryCohortExamSessionRepository();
    const diagnosticsRepository = createInMemoryDiagnosticLogRepository();
    const diagnostics = createDiagnosticRecorder({
      repository: diagnosticsRepository,
      secrets: ["secret-api-key"],
    });
    await seedPublishedExam(exams);
    await seedPublishedSession(sessions);

    const attempts: AdminCohortExamSessionAttemptRepository = {
      listBySessionId: vi.fn().mockResolvedValue([]),
    };

    const cloudshare: CloudShareClientFactory = {
      forConnection: () =>
        ({
          requestV4Detailed: vi.fn(async (spec: { path: string; schema: { parse(value: unknown): unknown } }) => {
            if (spec.path === "/guided-journey/progress/EXcohort-1") {
              throw new CloudShareRateLimitError("too many requests", 429, "rate_limit", {
                method: "GET",
                path: "/guided-journey/progress/EXcohort-1",
                integrationSurface: "cloudshare.v4.guided_journey.progress.aggregate",
                responseHeaders: { "retry-after": "45" },
              });
            }

            return {
              data: spec.schema.parse({ items: [] }),
              host: "api.accelerate.cloudshare.com",
              integrationSurface: "cloudshare.v4.training.participant",
              request: { method: "GET", path: "/v4/trainings/EXcohort-1/students" },
              response: { status: 200, body: { items: [] } },
            };
          }),
        }) as unknown as ReturnType<CloudShareClientFactory["forConnection"]>,
    };

    const response = await handleGetAdminCohortExamSessionDetail(
      {
        exams,
        sessions,
        attempts,
        diagnostics,
        connections: {
          findByCustomerId: vi.fn(async () => ({
            customerId: "customer-1",
            apiId: "api-id",
            apiKey: "secret-api-key",
            webhookSecret: "webhook-secret",
            webhookPathToken: "webhook-token",
            connectedAt: new Date("2026-07-01T00:00:00.000Z"),
            verifiedAt: new Date("2026-07-01T00:05:00.000Z"),
          })),
          save: vi.fn(),
          findByWebhookPathToken: vi.fn(),
          markVerified: vi.fn(),
        },
        cloudshare,
        logger: makeLogger(),
        newCorrelationId: () => "corr-session-detail-aggregate-rate-limit",
      },
      {
        customerId: "customer-1",
        examId: "exam-1",
        sessionId: "cohort-session-1",
      },
    );

    expect(response.status).toBe(200);
    if (!("monitoring" in response.body)) {
      throw new Error("Expected monitoring payload");
    }
    expect(response.body.monitoring.guidedJourneyAggregate.status).toBe("unavailable");

    const [entry] = await diagnosticsRepository.query({
      customerId: "customer-1",
      examId: "exam-1",
      operation: "cohort_exam_session.guided_journey_aggregate.read",
      outcome: "failure",
    });
    expect(entry).toMatchObject({
      correlationId: "corr-session-detail-aggregate-rate-limit",
      details: {
        integrationSurface: "cloudshare.v4.guided_journey.progress.aggregate",
        failureMode: "rate_limit",
        responseStatus: 429,
        experienceId: "EXcohort-1",
      },
      response: {
        status: 429,
        headers: { "retry-after": "45" },
      },
    });
  });

  it("records a diagnostic when no CloudShare Connection is saved for a published session", async () => {
    const exams = createInMemoryExamCatalogRepository();
    const sessions = createInMemoryCohortExamSessionRepository();
    const diagnosticsRepository = createInMemoryDiagnosticLogRepository();
    const diagnostics = createDiagnosticRecorder({
      repository: diagnosticsRepository,
      secrets: ["secret-api-key"],
    });
    await seedPublishedExam(exams);
    await seedPublishedSession(sessions);

    const attempts: AdminCohortExamSessionAttemptRepository = {
      listBySessionId: vi.fn().mockResolvedValue([]),
    };

    const response = await handleGetAdminCohortExamSessionDetail(
      {
        exams,
        sessions,
        attempts,
        diagnostics,
        connections: {
          findByCustomerId: vi.fn(async () => null),
          save: vi.fn(),
          findByWebhookPathToken: vi.fn(),
          markVerified: vi.fn(),
        },
        cloudshare: {
          forConnection: vi.fn(),
        },
        logger: makeLogger(),
        newCorrelationId: () => "corr-session-detail-missing-connection",
      },
      {
        customerId: "customer-1",
        examId: "exam-1",
        sessionId: "cohort-session-1",
      },
    );

    expect(response.status).toBe(200);
    if (!("monitoring" in response.body)) {
      throw new Error("Expected monitoring payload");
    }
    expect(response.body.monitoring.cloudShareParticipants).toMatchObject({
      status: "unavailable",
      participants: [],
      readError: "CloudShare participant read failed for this Cohort Exam Session.",
      correlationId: "corr-session-detail-missing-connection",
    });

    const [entry] = await diagnosticsRepository.query({
      customerId: "customer-1",
      examId: "exam-1",
      operation: "cohort_exam_session.monitor.read_participants",
      outcome: "failure",
    });
    expect(entry).toMatchObject({
      correlationId: "corr-session-detail-missing-connection",
      message: "CloudShare participant read could not start because no CloudShare Connection is saved",
      externalIds: {
        trainingId: "EXcohort-1",
        experienceId: "EXcohort-1",
      },
      request: null,
      response: null,
      details: {
        integrationSurface: "cloudshare.connection",
        failureMode: "missing_connection",
        trainingId: "EXcohort-1",
        experienceId: "EXcohort-1",
      },
    });
  });
});
