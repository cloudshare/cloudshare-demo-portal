import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

interface PortalSeedConfig {
  readonly heliosAdminEmail: string;
  readonly heliosAdminPassword: string;
}

interface CandidateExamItem {
  readonly id: string;
  readonly title: string;
  readonly timeLimitMinutes: number;
  readonly openPeriodMinutes: number;
  readonly scoreRetrievalEnabled: boolean;
}

interface CandidateAttemptItem {
  readonly id: string;
  readonly examId: string;
  readonly scheduledFor: string | null;
  readonly status: string;
}

interface AdminDiagnosticTimelineEntry {
  readonly occurredAt: string;
  readonly operation: string;
  readonly outcome: string;
  readonly correlationId: string | null;
  readonly integrationSurface: string | null;
  readonly request: Record<string, unknown> | null;
  readonly response: Record<string, unknown> | null;
  readonly details: Record<string, unknown> | null;
}

interface AdminDiagnosticDrilldown {
  readonly cloudShare: {
    readonly trainingId: string | null;
    readonly experienceId: string | null;
    readonly environmentExternalId: string | null;
    readonly environmentId: string | null;
    readonly participantId: string | null;
  };
  readonly timeline: readonly AdminDiagnosticTimelineEntry[];
}

function parseEnvFile(path: string): Record<string, string> {
  if (!existsSync(path)) {
    return {};
  }

  const values: Record<string, string> = {};
  for (const rawLine of readFileSync(path, "utf8").split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;

    const equals = line.indexOf("=");
    if (equals === -1) continue;

    const key = line.slice(0, equals).trim();
    let value = line.slice(equals + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    values[key] = value;
  }

  return values;
}

function resolveSeedConfigPath(): string | null {
  const processEnv = Object.fromEntries(
    Object.entries(process.env).filter((entry): entry is [string, string] => typeof entry[1] === "string"),
  );
  const env = {
    ...parseEnvFile(resolve(process.cwd(), ".env")),
    ...parseEnvFile(resolve(process.cwd(), ".env.e2e.local")),
    ...processEnv,
  };
  const configured = env.PORTAL_SEED_CONFIG_PATH;
  const candidates = configured
    ? [configured]
    : [
        "./config/portal-seed.local.json",
        "D:/Code_projects/cloudshare-demo-portal/config/portal-seed.local.json",
      ];

  for (const candidate of candidates) {
    const path = /^(?:[A-Za-z]:)?[\\/]/.test(candidate)
      ? candidate
      : resolve(process.cwd(), candidate);
    if (existsSync(path)) {
      return path;
    }
  }

  return null;
}

function loadPortalSeedConfig(): PortalSeedConfig | null {
  const seedPath = resolveSeedConfigPath();
  if (!seedPath || !existsSync(seedPath)) {
    return null;
  }

  const parsed = JSON.parse(readFileSync(seedPath, "utf8")) as Partial<PortalSeedConfig>;
  if (!parsed.heliosAdminEmail || !parsed.heliosAdminPassword) {
    return null;
  }

  return {
    heliosAdminEmail: parsed.heliosAdminEmail,
    heliosAdminPassword: parsed.heliosAdminPassword,
  };
}

const baseUrl = process.env.PORTAL_LIVE_BASE_URL ?? "http://localhost:3025";
const portalSeed = loadPortalSeedConfig();

async function login(email: string, password: string): Promise<{
  readonly status: number;
  readonly cookie: string;
  readonly body: Record<string, unknown>;
}> {
  const response = await fetch(`${baseUrl}/api/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  const body = (await response.json()) as Record<string, unknown>;
  return {
    status: response.status,
    cookie: response.headers.get("set-cookie") ?? "",
    body,
  };
}

async function authedJson<T>(
  cookie: string,
  path: string,
  init: RequestInit = {},
): Promise<{ readonly status: number; readonly body: T }> {
  const response = await fetch(`${baseUrl}${path}`, {
    ...init,
    headers: {
      ...(init.headers ?? {}),
      cookie,
    },
  });
  return {
    status: response.status,
    body: (await response.json()) as T,
  };
}

async function waitFor<T>(
  label: string,
  fn: () => Promise<T | null>,
  options: { readonly timeoutMs: number; readonly intervalMs: number },
): Promise<T> {
  const startedAt = Date.now();
  while (Date.now() - startedAt < options.timeoutMs) {
    const value = await fn();
    if (value !== null) {
      return value;
    }
    await sleep(options.intervalMs);
  }

  throw new Error(`Timed out waiting for ${label}`);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function chooseLiveExam(exams: readonly CandidateExamItem[]): CandidateExamItem {
  const preferred = exams.find((exam) => /^qa #328\b/i.test(exam.title));
  if (preferred) {
    return preferred;
  }

  const nonQa = exams.filter((exam) => exam.title !== "Windows Boxes" && !/^qa\b/i.test(exam.title));
  const pool = nonQa.length > 0 ? nonQa : exams;
  return [...pool].sort((a, b) => a.timeLimitMinutes - b.timeLimitMinutes)[0];
}

function summarizeTimelineEntry(entry: AdminDiagnosticTimelineEntry) {
  const request = entry.request as
    | { readonly method?: string; readonly path?: string; readonly query?: Record<string, unknown> }
    | null;
  const response = entry.response as
    | { readonly status?: number; readonly body?: unknown }
    | null;
  const details = entry.details as
    | {
        readonly attemptedOperation?: string;
        readonly failureMode?: string;
        readonly responseStatus?: number;
        readonly currentStatus?: string;
        readonly resumeDisposition?: string;
        readonly recoveryReason?: string;
      }
    | null;

  return {
    occurredAt: entry.occurredAt,
    operation: entry.operation,
    outcome: entry.outcome,
    correlationId: entry.correlationId,
    integrationSurface: entry.integrationSurface,
    request: request
      ? {
          method: request.method ?? null,
          path: request.path ?? null,
          query: request.query ?? null,
        }
      : null,
    response: response
      ? {
          status: response.status ?? null,
        }
      : null,
    details: details
      ? {
          attemptedOperation: details.attemptedOperation ?? null,
          failureMode: details.failureMode ?? null,
          responseStatus: details.responseStatus ?? null,
          currentStatus: details.currentStatus ?? null,
          resumeDisposition: details.resumeDisposition ?? null,
          recoveryReason: details.recoveryReason ?? null,
        }
      : null,
  };
}

describe("live rapid suspend/resume smoke", () => {
  it(
    "drives schedule -> enter -> rapid suspend/resume through the live portal path without a transient v3 500",
    async () => {
      expect(
        portalSeed,
        "Set PORTAL_SEED_CONFIG_PATH or create ./config/portal-seed.local.json for live portal smoke tests.",
      ).not.toBeNull();
      const seed = portalSeed!;
      let candidateCookie: string | null = null;
      let attemptId: string | null = null;
      let drilldown: AdminDiagnosticDrilldown | null = null;
      let finalSuspend: { readonly status: number; readonly body: Record<string, unknown> } | null = null;
      const operations: Array<Record<string, unknown>> = [];

      let adminCookie = "";
      let exam: CandidateExamItem | null = null;
      let scheduledFor = "";
      let scheduleCorrelationId = "";
      let coldStartLikely: boolean | null = null;

      try {
      const admin = await login(
        seed.heliosAdminEmail,
        seed.heliosAdminPassword,
      );
      expect(admin.status).toBe(200);
      adminCookie = admin.cookie;

      const candidateEmail = `issue104.${Date.now()}@helioscx.demo`;
      const candidatePassword = "correct-horse-battery-staple";

      const registerResponse = await fetch(`${baseUrl}/api/candidate/register`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          firstName: "Issue104",
          lastName: "LiveSmoke",
          email: candidateEmail,
          password: candidatePassword,
        }),
      });
      expect(registerResponse.status).toBe(201);

      const candidate = await login(candidateEmail, candidatePassword);
      expect(candidate.status).toBe(200);
      candidateCookie = candidate.cookie;

      const catalog = await authedJson<{ readonly exams: CandidateExamItem[] }>(
        candidate.cookie,
        "/api/candidate/exams",
      );
      expect(catalog.status).toBe(200);
      expect(catalog.body.exams.length).toBeGreaterThan(0);

      exam = chooseLiveExam(catalog.body.exams);
      scheduledFor = new Date(Date.now() + 70_000).toISOString();
      const schedule = await authedJson<{
        readonly attempt: CandidateAttemptItem;
        readonly coldStartLikely: boolean;
        readonly correlationId: string;
      }>(candidate.cookie, "/api/candidate/exams", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ examId: exam.id, scheduledFor }),
      });
      expect(schedule.status).toBe(201);
      scheduleCorrelationId = schedule.body.correlationId;
      coldStartLikely = schedule.body.coldStartLikely;

      attemptId = schedule.body.attempt.id;
      const scheduledForMs = Date.parse(schedule.body.attempt.scheduledFor ?? scheduledFor);
      const waitForStartMs = Math.max(0, scheduledForMs - Date.now() + 5_000);
      await sleep(waitForStartMs);

      const enterResponse = await fetch(
        `${baseUrl}/enter?examAttemptId=${encodeURIComponent(attemptId)}`,
        {
          headers: { cookie: candidate.cookie },
          redirect: "follow",
        },
      );
      expect(enterResponse.status).toBe(200);
      expect(new URL(enterResponse.url).origin).toBe("https://use.cloudshare.com");

      drilldown = await waitFor(
        "CloudShare environment correlation",
        async (): Promise<AdminDiagnosticDrilldown | null> => {
          const dashboard = await authedJson<{
            readonly attempts: CandidateAttemptItem[];
          }>(candidate.cookie, "/api/candidate/exams");
          expect(dashboard.status).toBe(200);
          const attempt = dashboard.body.attempts.find((item) => item.id === attemptId);
          if (!attempt || attempt.status !== "in_progress") {
            return null;
          }

          const diagnostics = await authedJson<{
            readonly drilldown?: AdminDiagnosticDrilldown;
          }>(admin.cookie, `/api/admin/diagnostics/attempts/${encodeURIComponent(attemptId!)}`);
          expect(diagnostics.status).toBe(200);
          const current = diagnostics.body.drilldown ?? null;
          return current?.cloudShare.environmentExternalId || current?.cloudShare.environmentId
            ? current
            : null;
        },
        { timeoutMs: 180_000, intervalMs: 10_000 },
      );

      for (let cycle = 1; cycle <= 6; cycle += 1) {
        const suspend = await authedJson<Record<string, unknown>>(
          candidate.cookie,
          "/api/exam/suspend",
          {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ examAttemptId: attemptId }),
          },
        );
        operations.push({
          cycle,
          action: "suspend",
          at: new Date().toISOString(),
          status: suspend.status,
          body: suspend.body,
        });

        const primaryResumePromise = authedJson<Record<string, unknown>>(
          candidate.cookie,
          "/api/exam/resume",
          {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ examAttemptId: attemptId }),
          },
        );
        await sleep(250);
        const secondaryResumePromise = authedJson<Record<string, unknown>>(
          candidate.cookie,
          "/api/exam/resume",
          {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ examAttemptId: attemptId }),
          },
        );

        const [primaryResume, secondaryResume] = await Promise.all([
          primaryResumePromise,
          secondaryResumePromise,
        ]);
        operations.push({
          cycle,
          action: "resume-primary",
          at: new Date().toISOString(),
          status: primaryResume.status,
          body: primaryResume.body,
        });
        operations.push({
          cycle,
          action: "resume-secondary",
          at: new Date().toISOString(),
          status: secondaryResume.status,
          body: secondaryResume.body,
        });
        await sleep(500);
      }
      } finally {
        if (candidateCookie && attemptId) {
          try {
            finalSuspend = await authedJson<Record<string, unknown>>(
              candidateCookie,
              "/api/exam/suspend",
              {
                method: "POST",
                headers: { "content-type": "application/json" },
                body: JSON.stringify({ examAttemptId: attemptId }),
              },
            );
            operations.push({
              cycle: "cleanup",
              action: "suspend",
              at: new Date().toISOString(),
              status: finalSuspend.status,
              body: finalSuspend.body,
            });
          } catch (error) {
            operations.push({
              cycle: "cleanup",
              action: "suspend",
              at: new Date().toISOString(),
              status: "cleanup_error",
              body: { error: error instanceof Error ? error.message : String(error) },
            });
          }
        }
      }

      expect(attemptId).not.toBeNull();
      expect(drilldown).not.toBeNull();
      expect(finalSuspend?.status).toBe(200);

      const finalDiagnostics = await authedJson<{
        readonly drilldown?: AdminDiagnosticDrilldown;
      }>(adminCookie, `/api/admin/diagnostics/attempts/${encodeURIComponent(attemptId!)}`);
      expect(finalDiagnostics.status).toBe(200);
      const finalDrilldown = finalDiagnostics.body.drilldown;
      expect(finalDrilldown).toBeDefined();

      const failureRows =
        finalDrilldown?.timeline.filter((entry) => {
          const responseStatus =
            typeof (entry.response as { readonly status?: unknown } | null)?.status === "number"
              ? ((entry.response as { readonly status: number }).status)
              : null;
          const detailResponseStatus =
            typeof (entry.details as { readonly responseStatus?: unknown } | null)?.responseStatus ===
            "number"
              ? ((entry.details as { readonly responseStatus: number }).responseStatus)
              : null;
          return (
            entry.outcome === "failure" ||
            responseStatus === 500 ||
            detailResponseStatus === 500
          );
        }) ?? [];

      console.log(
        JSON.stringify(
          {
            exam: {
              id: exam?.id,
              title: exam?.title,
            },
            schedule: {
              attemptId,
              scheduledFor,
              coldStartLikely,
              correlationId: scheduleCorrelationId,
            },
            cloudShare: {
              trainingId: drilldown!.cloudShare.trainingId,
              environmentId:
                drilldown!.cloudShare.environmentExternalId ?? drilldown!.cloudShare.environmentId,
              participantId: drilldown!.cloudShare.participantId,
            },
            operations,
            failureRows: failureRows.map(summarizeTimelineEntry),
          },
          null,
          2,
        ),
      );

      expect(operations.every((operation) => (operation.status as number) === 200)).toBe(true);
      expect(failureRows).toEqual([]);
    },
    420_000,
  );
});
