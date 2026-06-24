import { createHmac } from "node:crypto";
import { describe, it, expect } from "vitest";
import {
  computeWebhookSignature,
  parseWebhookEvent,
  synthesiseIdempotencyKey,
  verifyWebhookSignature,
  type CloudShareEnvironmentEvent,
} from "./webhooks";

const SECRET = "account-webhook-secret";

const validBody = JSON.stringify({
  Event: "environment.suspended",
  CreatedAt: "2026-06-08T10:00:00Z",
  Payload: {
    environmentExternalId: "env-ext-1",
  },
});

function sign(body: string, secret = SECRET): string {
  return createHmac("sha256", secret).update(body).digest("base64");
}

describe("verifyWebhookSignature", () => {
  it("accepts a correct HMAC-SHA256 base64 signature over the raw body", () => {
    expect(verifyWebhookSignature(validBody, sign(validBody), SECRET)).toBe(true);
  });

  it("computeWebhookSignature matches an independent HMAC computation", () => {
    expect(computeWebhookSignature(validBody, SECRET)).toBe(sign(validBody));
  });

  it("rejects a signature computed over a tampered body", () => {
    const tampered = validBody.replace("suspended", "resumed");
    expect(verifyWebhookSignature(tampered, sign(validBody), SECRET)).toBe(false);
  });

  it("rejects a signature made with the wrong secret", () => {
    expect(verifyWebhookSignature(validBody, sign(validBody, "wrong"), SECRET)).toBe(false);
  });

  it("rejects an empty or malformed signature without throwing", () => {
    expect(verifyWebhookSignature(validBody, "", SECRET)).toBe(false);
    expect(verifyWebhookSignature(validBody, "not-base64-$$$", SECRET)).toBe(false);
    expect(verifyWebhookSignature(validBody, "c2hvcnQ=", SECRET)).toBe(false); // valid b64, wrong length
  });
});

describe("parseWebhookEvent", () => {
  it("parses a valid payload into a normalised event", () => {
    const result = parseWebhookEvent(validBody);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.event).toEqual<CloudShareEnvironmentEvent>({
        event: "environment.suspended",
        environmentExternalId: "env-ext-1",
        ownerEmail: null,
        environmentName: null,
        createdAt: "2026-06-08T10:00:00Z",
      });
    }
  });

  it("accepts the documented CloudShare v3 event shape with extra metadata fields", () => {
    const body = JSON.stringify({
      Event: "environment.created",
      CreatedAt: "2026-06-08T10:00:00Z",
      CreatedById: "user-1",
      CreatedByEmail: "admin@example.com",
      Attempt: 1,
      Payload: {
        environmentExternalId: "env-ext-2",
        environmentName: "Exam Lab",
      },
    });

    const result = parseWebhookEvent(body);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.event.environmentExternalId).toBe("env-ext-2");
      expect(result.event.environmentName).toBe("Exam Lab");
    }
  });

  it("accepts the live CloudShare v3 shape where Payload is a JSON string with PascalCase fields", () => {
    const body = JSON.stringify({
      Event: "environment.created",
      CreatedAt: "2026-06-19T20:45:14.3838933",
      CreatedById: "USUhmU1Bg9K9PNx1vUm2waaQ2",
      CreatedByEmail: "Chris.Swinney+acceleratetesting@Cloudshare.com",
      Attempt: 1,
      Payload: JSON.stringify({
        EnvironmentId: "ENT0KnYJsuNgzaBZk9NdeDRQ2",
        EnvironmentExternalId: null,
        EnvironmentName: "Linux Boxes",
        BlueprintId: "BP4tUkq129wKUYtAndnfwuuA2",
        BlueprintName: "Linux Boxes",
        PolicyId: "POavMAu1wiaVydJdYUOAExJg2",
        PolicyName: "10 mins run time - 2 days storage - Always on",
        OwnerEmail: "Chris.Swinney+acceleratetesting@Cloudshare.com",
        Cloud: ["cloudshare"],
        RegionId: "REKolD1-ab84YIxODeMGob9A2",
      }),
    });

    const result = parseWebhookEvent(body);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.event.environmentExternalId).toBe("ENT0KnYJsuNgzaBZk9NdeDRQ2");
      expect(result.event.environmentName).toBe("Linux Boxes");
      expect(result.event.ownerEmail).toBe("Chris.Swinney+acceleratetesting@Cloudshare.com");
    }
  });

  it("rejects the old top-level EnvironmentId fixture shape", () => {
    const body = JSON.stringify({
      Event: "environment.created",
      EnvironmentId: "legacy-env-1",
      CreatedAt: "2026-06-08T10:00:00Z",
    });

    const result = parseWebhookEvent(body);
    expect(result.ok).toBe(false);
  });

  it("rejects non-environment webhook event types", () => {
    const body = JSON.stringify({
      Event: "student.enrolled",
      CreatedAt: "2026-06-08T10:00:00Z",
      Payload: {
        studentEmail: "candidate@example.com",
      },
    });
    const result = parseWebhookEvent(body);
    expect(result.ok).toBe(false);
  });

  it("rejects a payload missing a required field", () => {
    const body = JSON.stringify({ Event: "environment.created" });
    const result = parseWebhookEvent(body);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.issues.length).toBeGreaterThan(0);
  });

  it("rejects a body that is not valid JSON", () => {
    const result = parseWebhookEvent("<<<not json>>>");
    expect(result.ok).toBe(false);
  });
});

describe("synthesiseIdempotencyKey", () => {
  const base: CloudShareEnvironmentEvent = {
    event: "environment.suspended",
    environmentExternalId: "env-ext-1",
    ownerEmail: null,
    environmentName: null,
    createdAt: "2026-06-08T10:00:00Z",
  };

  it("is stable for the same (environmentExternalId, event, createdAt)", () => {
    expect(synthesiseIdempotencyKey(base)).toBe(synthesiseIdempotencyKey({ ...base }));
  });

  it("differs when any of the three components differ", () => {
    const key = synthesiseIdempotencyKey(base);
    expect(synthesiseIdempotencyKey({ ...base, environmentExternalId: "env-ext-2" })).not.toBe(key);
    expect(synthesiseIdempotencyKey({ ...base, event: "environment.resumed" })).not.toBe(key);
    expect(synthesiseIdempotencyKey({ ...base, createdAt: "2026-06-08T11:00:00Z" })).not.toBe(key);
  });
});
