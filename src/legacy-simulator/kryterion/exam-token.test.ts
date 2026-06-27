import { describe, expect, it } from "vitest";
import {
  ExpiredLegacyExamTokenError,
  InvalidLegacyExamTokenError,
  legacyExamTokenClaimsSchema,
  signLegacyExamToken,
  verifyLegacyExamToken,
} from "./exam-token";

const secret = "kryterion-secret";
const issuedAtS = 1_000_000;
const claims = {
  jti: "tok-1",
  examAttemptId: "ea-123",
  candidateId: "cand-9",
  iat: issuedAtS,
  exp: issuedAtS + 60,
};

describe("signLegacyExamToken / verifyLegacyExamToken", () => {
  it("round-trips claims for a valid, unexpired token", () => {
    const token = signLegacyExamToken(claims, secret);
    const verified = verifyLegacyExamToken(token, {
      secret,
      now: () => issuedAtS * 1000,
    });
    expect(verified).toEqual(claims);
  });

  it("rejects a token signed with a different secret", () => {
    const token = signLegacyExamToken(claims, "other-secret");
    expect(() =>
      verifyLegacyExamToken(token, { secret, now: () => issuedAtS * 1000 }),
    ).toThrow(InvalidLegacyExamTokenError);
  });

  it("rejects a tampered payload whose signature no longer matches", () => {
    const token = signLegacyExamToken(claims, secret);
    const [, sig] = token.split(".");
    const forged = Buffer.from(
      JSON.stringify({ ...claims, examAttemptId: "ea-OTHER" }),
    ).toString("base64url");
    expect(() =>
      verifyLegacyExamToken(`${forged}.${sig}`, { secret, now: () => issuedAtS * 1000 }),
    ).toThrow(InvalidLegacyExamTokenError);
  });

  it("rejects a malformed token", () => {
    expect(() =>
      verifyLegacyExamToken("not-a-token", { secret, now: () => issuedAtS * 1000 }),
    ).toThrow(InvalidLegacyExamTokenError);
  });

  it("rejects an expired token", () => {
    const token = signLegacyExamToken(claims, secret);
    expect(() =>
      verifyLegacyExamToken(token, { secret, now: () => (issuedAtS + 61) * 1000 }),
    ).toThrow(ExpiredLegacyExamTokenError);
  });
});

describe("legacyExamTokenClaimsSchema", () => {
  it("rejects exp: 0", () => {
    const result = legacyExamTokenClaimsSchema.safeParse({
      jti: "tok-1",
      examAttemptId: "ea-1",
      candidateId: "cand-1",
      iat: 1_000_000,
      exp: 0,
    });
    expect(result.success).toBe(false);
    expect(result.error?.issues[0].path).toEqual(["exp"]);
  });

  it("rejects iat: 0", () => {
    const result = legacyExamTokenClaimsSchema.safeParse({
      jti: "tok-1",
      examAttemptId: "ea-1",
      candidateId: "cand-1",
      iat: 0,
      exp: 1_000_060,
    });
    expect(result.success).toBe(false);
    expect(result.error?.issues[0].path).toEqual(["iat"]);
  });

  it("accepts valid positive timestamps", () => {
    const result = legacyExamTokenClaimsSchema.safeParse({
      jti: "tok-1",
      examAttemptId: "ea-1",
      candidateId: "cand-1",
      iat: 1_000_000,
      exp: 1_000_060,
    });
    expect(result.success).toBe(true);
  });
});
