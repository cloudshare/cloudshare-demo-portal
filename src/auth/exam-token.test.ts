import { describe, it, expect } from "vitest";
import { signExamToken, verifyExamToken, examTokenClaimsSchema } from "./exam-token";
import { ExpiredExamTokenError, InvalidExamTokenError } from "./errors";

const secret = "kryterion-secret";
// Fixed "now": 1,000,000s. Tokens below expire at 1,000,060s (60s TTL).
const issuedAtS = 1_000_000;
const claims = {
  jti: "tok-1",
  examAttemptId: "ea-123",
  candidateId: "cand-9",
  iat: issuedAtS,
  exp: issuedAtS + 60,
};

describe("signExamToken / verifyExamToken", () => {
  it("round-trips claims for a valid, unexpired token", () => {
    const token = signExamToken(claims, secret);
    const verified = verifyExamToken(token, { secret, now: () => issuedAtS * 1000 });
    expect(verified).toEqual(claims);
  });

  it("rejects a token signed with a different secret", () => {
    const token = signExamToken(claims, "other-secret");
    expect(() =>
      verifyExamToken(token, { secret, now: () => issuedAtS * 1000 }),
    ).toThrow(InvalidExamTokenError);
  });

  it("rejects a tampered payload (signature no longer matches)", () => {
    const token = signExamToken(claims, secret);
    const [, sig] = token.split(".");
    const forged = Buffer.from(
      JSON.stringify({ ...claims, examAttemptId: "ea-OTHER" }),
    ).toString("base64url");
    expect(() =>
      verifyExamToken(`${forged}.${sig}`, { secret, now: () => issuedAtS * 1000 }),
    ).toThrow(InvalidExamTokenError);
  });

  it("rejects a malformed token (not two dot-separated parts)", () => {
    expect(() =>
      verifyExamToken("not-a-token", { secret, now: () => issuedAtS * 1000 }),
    ).toThrow(InvalidExamTokenError);
  });

  it("rejects an expired token", () => {
    const token = signExamToken(claims, secret);
    // 61s later — past the 60s TTL.
    expect(() =>
      verifyExamToken(token, { secret, now: () => (issuedAtS + 61) * 1000 }),
    ).toThrow(ExpiredExamTokenError);
  });
});

describe("examTokenClaimsSchema", () => {
  it("rejects exp: 0 (epoch-zero is always-expired, not a valid expiry)", () => {
    const result = examTokenClaimsSchema.safeParse({
      jti: "tok-1",
      examAttemptId: "ea-1",
      candidateId: "cand-1",
      iat: 1_000_000,
      exp: 0,
    });
    expect(result.success).toBe(false);
  });

  it("rejects iat: 0 (epoch-zero is not a valid issue time)", () => {
    const result = examTokenClaimsSchema.safeParse({
      jti: "tok-1",
      examAttemptId: "ea-1",
      candidateId: "cand-1",
      iat: 0,
      exp: 1_000_060,
    });
    expect(result.success).toBe(false);
  });

  it("accepts valid positive timestamps", () => {
    const result = examTokenClaimsSchema.safeParse({
      jti: "tok-1",
      examAttemptId: "ea-1",
      candidateId: "cand-1",
      iat: 1_000_000,
      exp: 1_000_060,
    });
    expect(result.success).toBe(true);
  });
});
