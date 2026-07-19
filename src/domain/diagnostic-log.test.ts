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
  it("masks all request headers while retaining request and response body evidence verbatim", () => {
    const redacted = redactDiagnosticInput({
      source: "auth",
      operation: "portal.login",
      outcome: "success",
      message: "ok",
      request: {
        body: { email: "candidate@example.com", password: "hunter2", nested: [{ passphrase: "request-passphrase", accessLink: "https://request.test/link" }] },
        headers: {
          authorization: "Bearer abc.def",
          "x-cloudshare-signature": "raw-signature-value",
        },
      },
      response: { body: { token: "sek-123", passphrase: "response-passphrase", accessLink: "https://response.test/link", loginUrl: "https://response.test/login", nested: [{ authorization: "body-data" }] }, status: 200 },
      details: { request: { headers: { Authorization: "Bearer nested", cookie: "nested-cookie" }, body: { token: "nested-token" } }, note: "fine" },
    });

    expect(redacted.request).toEqual({
      body: { email: "candidate@example.com", password: "hunter2", nested: [{ passphrase: "request-passphrase", accessLink: "https://request.test/link" }] },
      headers: {
        authorization: "[REDACTED]",
        "x-cloudshare-signature": "[REDACTED]",
      },
    });
    expect(redacted.response).toEqual({ body: { token: "sek-123", passphrase: "response-passphrase", accessLink: "https://response.test/link", loginUrl: "https://response.test/login", nested: [{ authorization: "body-data" }] }, status: 200 });
    expect(redacted.details).toEqual({ request: { headers: { Authorization: "[REDACTED]", cookie: "[REDACTED]" }, body: { token: "nested-token" } }, note: "fine" });
  });

  it("does not scrub protected body evidence based on literal values", () => {
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

    expect(redacted.message).toBe("failed with secret sk-live-9999");
    expect(redacted.details).toEqual({ trace: "used sk-live-9999 here" });
  });

  it("treats body collision keys as opaque and masks scalar and tuple request-header shapes", () => {
    const body = { headers: "body-headers", requestHeaders: [["body", "value"]], request: { headers: "nested-body" } };
    const scalar = redactDiagnosticInput({ source: "x", operation: "x", outcome: "success", message: "x", request: { headers: "Bearer scalar", body } });
    const tuples = redactDiagnosticInput({ source: "x", operation: "x", outcome: "success", message: "x", request: { requestHeaders: [["Authorization", "Bearer tuple"], ["Cookie", "cookie"]], body } });
    expect(scalar.request).toEqual({ headers: "[REDACTED]", body });
    expect(tuples.request).toEqual({ requestHeaders: [["Authorization", "[REDACTED]"], ["Cookie", "[REDACTED]"]], body });
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

  it("does not field-name scrub opaque diagnostic metadata", () => {
    const redacted = redactDiagnosticInput({
      source: "integration",
      operation: "cloudshare.read",
      outcome: "success",
      message: "ok",
      externalIds: { environmentId: "env_1", apiKey: "leak" },
    });
    expect(redacted.externalIds).toEqual({ environmentId: "env_1", apiKey: "leak" });
  });

  it("retains Sales Experience passphrases from request bodies", () => {
    const redacted = redactDiagnosticInput({
      source: "integration",
      operation: "sales.enablement_session.created",
      outcome: "failure",
      message: "CloudShare rejected a Sales Experience",
      request: { body: { passphrase: "ephemeral-sales-passphrase" } },
    });
    expect(JSON.stringify(redacted)).toContain("ephemeral-sales-passphrase");
    expect(redacted.request).toEqual({ body: { passphrase: "ephemeral-sales-passphrase" } });
  });

  it("retains Sales participant access links from response bodies", () => {
    const redacted = redactDiagnosticInput({
      source: "sales-session-participants",
      operation: "sales.demo_session.participants.reconciled",
      outcome: "success",
      message: "CloudShare reconciliation completed",
      response: { body: { accessLink: "https://bearer.example.test/native-invite", invitationUrl: "https://bearer.example.test/resend" } },
    });

    expect(JSON.stringify(redacted)).toContain("https://bearer.example.test");
    expect(redacted.response).toEqual({ body: { accessLink: "https://bearer.example.test/native-invite", invitationUrl: "https://bearer.example.test/resend" } });
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
  it("masks request headers before persisting without altering bodies", async () => {
    const repo = fakeRepository();
    const recorder = createDiagnosticRecorder({ repository: repo, secrets: ["topsecret"] });

    await recorder.record({
      source: "auth",
      operation: "portal.login",
      outcome: "success",
      message: "logged in topsecret",
      request: { headers: { Authorization: "Bearer p" }, body: { password: "p" } },
    });

    expect(repo.appended).toHaveLength(1);
    expect(repo.appended[0].message).toBe("logged in topsecret");
    expect(repo.appended[0].request).toEqual({ headers: { Authorization: "[REDACTED]" }, body: { password: "p" } });
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

  it("does not allow sensitiveMode to bypass request-header masking", async () => {
    const repo = fakeRepository();
    const recorder = createDiagnosticRecorder({ repository: repo, sensitiveMode: true });
    await recorder.record({
      source: "auth",
      operation: "portal.login",
      outcome: "success",
      message: "ok",
      request: { headers: { Authorization: "Bearer p" }, body: { password: "p" } },
    });
    expect(repo.appended[0].request).toEqual({ headers: { Authorization: "[REDACTED]" }, body: { password: "p" } });
  });
});
