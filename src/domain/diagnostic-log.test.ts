import { describe, expect, it, vi } from "vitest";
import {
  boundDiagnosticLimit,
  createDiagnosticRecorder,
  DEFAULT_DIAGNOSTIC_QUERY_LIMIT,
  MAX_DIAGNOSTIC_QUERY_LIMIT,
  redactDiagnosticInput,
  type DiagnosticLogEntry,
  type DiagnosticLogEntryInput,
  type DiagnosticLogRepository,
} from "./diagnostic-log";

function fakeRepository(): DiagnosticLogRepository & {
  appended: DiagnosticLogEntryInput[];
} {
  const appended: DiagnosticLogEntryInput[] = [];
  return {
    appended,
    async append(input) {
      appended.push(input);
      return { id: "x", occurredAt: new Date(0), level: "info", ...input } as DiagnosticLogEntry;
    },
    async query() {
      return [];
    },
  };
}

describe("redactDiagnosticInput", () => {
  it("redacts sensitive keys in request/response/details by default", () => {
    const redacted = redactDiagnosticInput({
      source: "auth",
      operation: "portal.login",
      outcome: "success",
      message: "ok",
      request: {
        email: "candidate@example.com",
        password: "hunter2",
        headers: {
          authorization: "Bearer abc.def",
          "x-cloudshare-signature": "raw-signature-value",
        },
      },
      response: { token: "sek-123", status: 200 },
      details: { apiKey: "key-xyz", note: "fine" },
    });

    expect(redacted.request).toEqual({
      email: "candidate@example.com",
      password: "[REDACTED]",
      headers: {
        authorization: "[REDACTED]",
        "x-cloudshare-signature": "[REDACTED]",
      },
    });
    expect(redacted.response).toEqual({ token: "[REDACTED]", status: 200 });
    expect(redacted.details).toEqual({ apiKey: "[REDACTED]", note: "fine" });
  });

  it("scrubs known secret values embedded in strings and messages", () => {
    const redacted = redactDiagnosticInput(
      {
        source: "auth",
        operation: "portal.login",
        outcome: "failure",
        message: "failed with secret sk-live-9999",
        details: { trace: "used sk-live-9999 here" },
      },
      { secrets: ["sk-live-9999"] },
    );

    expect(redacted.message).toBe("failed with secret [REDACTED]");
    expect(redacted.details).toEqual({ trace: "used [REDACTED] here" });
  });

  it("preserves first-class correlation anchors (they are identifiers, not secrets)", () => {
    const redacted = redactDiagnosticInput({
      source: "candidate-portal",
      operation: "candidate.account.create",
      outcome: "success",
      message: "created",
      customerId: "cust_1",
      candidateEmail: "person@example.com",
      examId: "exam_1",
      examAttemptId: "att_1",
      correlationId: "corr_1",
    });

    expect(redacted.customerId).toBe("cust_1");
    expect(redacted.candidateEmail).toBe("person@example.com");
    expect(redacted.examId).toBe("exam_1");
    expect(redacted.examAttemptId).toBe("att_1");
    expect(redacted.correlationId).toBe("corr_1");
  });

  it("redacts sensitive keys nested in externalIds", () => {
    const redacted = redactDiagnosticInput({
      source: "integration",
      operation: "cloudshare.read",
      outcome: "success",
      message: "ok",
      externalIds: { environmentId: "env_1", apiKey: "leak" },
    });
    expect(redacted.externalIds).toEqual({ environmentId: "env_1", apiKey: "[REDACTED]" });
  });

  it("retains sponsored-link loginUrl values in admin diagnostic payloads", () => {
    const redacted = redactDiagnosticInput({
      source: "integration",
      operation: "cloudshare.create_sponsored_link",
      outcome: "success",
      message: "Created sponsored link",
      response: {
        loginUrl: "https://use.cloudshare.com/Ent/Course.mvc/ClassSponsoredLink/secret-token",
      },
      details: {
        responseBody: {
          loginUrl: "https://classic.cloudshare.com/Ent/Login.aspx?token=demo-sponsored-token",
        },
      },
    });

    expect(redacted.response).toEqual({
      loginUrl: "https://use.cloudshare.com/Ent/Course.mvc/ClassSponsoredLink/secret-token",
    });
    expect(redacted.details).toEqual({
      responseBody: {
        loginUrl: "https://classic.cloudshare.com/Ent/Login.aspx?token=demo-sponsored-token",
      },
    });
  });

  it("retains sponsored-link URLs embedded in admin diagnostic strings", () => {
    const redacted = redactDiagnosticInput({
      source: "integration",
      operation: "cloudshare.create_sponsored_link",
      outcome: "failure",
      message:
        "CloudShare returned https://use.cloudshare.com/Ent/Course.mvc/ClassSponsoredLink/secret-token",
      details: {
        trace:
          "redirect target https://classic.cloudshare.com/Ent/Login.aspx?token=demo-sponsored-token",
      },
    });

    expect(redacted.message).toBe(
      "CloudShare returned https://use.cloudshare.com/Ent/Course.mvc/ClassSponsoredLink/secret-token",
    );
    expect(redacted.details).toEqual({
      trace: "redirect target https://classic.cloudshare.com/Ent/Login.aspx?token=demo-sponsored-token",
    });
  });
});

describe("boundDiagnosticLimit", () => {
  it("defaults when absent or invalid", () => {
    expect(boundDiagnosticLimit()).toBe(DEFAULT_DIAGNOSTIC_QUERY_LIMIT);
    expect(boundDiagnosticLimit(0)).toBe(DEFAULT_DIAGNOSTIC_QUERY_LIMIT);
    expect(boundDiagnosticLimit(-5)).toBe(DEFAULT_DIAGNOSTIC_QUERY_LIMIT);
    expect(boundDiagnosticLimit(Number.NaN)).toBe(DEFAULT_DIAGNOSTIC_QUERY_LIMIT);
  });

  it("caps at the hard maximum", () => {
    expect(boundDiagnosticLimit(10)).toBe(10);
    expect(boundDiagnosticLimit(99999)).toBe(MAX_DIAGNOSTIC_QUERY_LIMIT);
  });
});

describe("createDiagnosticRecorder", () => {
  it("applies redaction before persisting", async () => {
    const repo = fakeRepository();
    const recorder = createDiagnosticRecorder({ repository: repo, secrets: ["topsecret"] });

    await recorder.record({
      source: "auth",
      operation: "portal.login",
      outcome: "success",
      message: "logged in topsecret",
      details: { password: "p" },
    });

    expect(repo.appended).toHaveLength(1);
    expect(repo.appended[0].message).toBe("logged in [REDACTED]");
    expect(repo.appended[0].details).toEqual({ password: "[REDACTED]" });
  });

  it("never throws when persistence fails, and reports via onError", async () => {
    const onError = vi.fn();
    const recorder = createDiagnosticRecorder({
      repository: {
        async append() {
          throw new Error("db down");
        },
        async query() {
          return [];
        },
      },
      onError,
    });

    await expect(
      recorder.record({
        source: "auth",
        operation: "portal.login",
        outcome: "failure",
        message: "x",
      }),
    ).resolves.toBeUndefined();
    expect(onError).toHaveBeenCalledOnce();
  });

  it("does not redact when sensitive mode is explicitly enabled (guarded seam)", async () => {
    const repo = fakeRepository();
    const recorder = createDiagnosticRecorder({ repository: repo, sensitiveMode: true });
    await recorder.record({
      source: "auth",
      operation: "portal.login",
      outcome: "success",
      message: "ok",
      details: { password: "p" },
    });
    expect(repo.appended[0].details).toEqual({ password: "p" });
  });
});
