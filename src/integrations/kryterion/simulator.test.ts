import { describe, it, expect } from "vitest";
import { createKryterionSimulator } from "./simulator";
import { verifyExamToken } from "@/auth/exam-token";

const secret = "kryterion-secret";
const nowS = 1_000_000;

function makeSim(overrides = {}) {
  let n = 0;
  return createKryterionSimulator({
    secret,
    ttlSeconds: 60,
    now: () => nowS * 1000,
    newJti: () => `jti-${++n}`,
    ...overrides,
  });
}

describe("kryterionSimulator.mintExamToken", () => {
  it("mints a token the auth layer accepts, bound to the given ExamAttempt", () => {
    const sim = makeSim();
    const token = sim.mintExamToken({ examAttemptId: "ea-77", candidateId: "cand-3" });

    const claims = verifyExamToken(token, { secret, now: () => nowS * 1000 });
    expect(claims.examAttemptId).toBe("ea-77");
    expect(claims.candidateId).toBe("cand-3");
  });

  it("sets a short TTL: iat = now, exp = now + ttlSeconds", () => {
    const sim = makeSim();
    const token = sim.mintExamToken({ examAttemptId: "ea-1", candidateId: "c-1" });
    const claims = verifyExamToken(token, { secret, now: () => nowS * 1000 });
    expect(claims.iat).toBe(nowS);
    expect(claims.exp).toBe(nowS + 60);
  });

  it("mints a unique single-use jti per call", () => {
    const sim = makeSim();
    const t1 = sim.mintExamToken({ examAttemptId: "ea-1", candidateId: "c-1" });
    const t2 = sim.mintExamToken({ examAttemptId: "ea-1", candidateId: "c-1" });
    const c1 = verifyExamToken(t1, { secret, now: () => nowS * 1000 });
    const c2 = verifyExamToken(t2, { secret, now: () => nowS * 1000 });
    expect(c1.jti).not.toBe(c2.jti);
  });
});
