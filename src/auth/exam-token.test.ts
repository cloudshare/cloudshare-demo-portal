import { describe, it, expect } from "vitest";
import { signExamToken, verifyExamToken } from "./exam-token";
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
