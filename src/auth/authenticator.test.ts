import { describe, it, expect } from "vitest";
import { createTokenCandidateAuthenticator } from "./authenticator";
import { signExamToken } from "./exam-token";
import {
  createInMemoryConsumedTokenStore,
  createInMemoryCandidateSessionStore,
} from "./stores";
import {
  ExpiredExamTokenError,
  InvalidExamTokenError,
  TokenAlreadyUsedError,
} from "./errors";

const secret = "kryterion-secret";
const nowS = 1_000_000;
const now = () => nowS * 1000;

function tokenFor(examAttemptId: string, overrides: Record<string, unknown> = {}) {
  return signExamToken(
    {
      jti: `jti-${examAttemptId}`,
      examAttemptId,
      candidateId: "cand-1",
      iat: nowS,
      exp: nowS + 60,
      ...overrides,
    },
    secret,
  );
}

function makeAuth() {
  let n = 0;
  return createTokenCandidateAuthenticator({
    secret,
    now,
    consumedTokens: createInMemoryConsumedTokenStore(),
    sessions: createInMemoryCandidateSessionStore(),
    newSessionId: () => `session-${++n}`,
  });
}

describe("tokenCandidateAuthenticator.admit", () => {
  it("admits a candidate to exactly the ExamAttempt the token is bound to", async () => {
    const auth = makeAuth();
    const session = await auth.admit(tokenFor("ea-123"));

    expect(session.examAttemptId).toBe("ea-123");
    expect(session.candidateId).toBe("cand-1");
    expect(session.sessionId).toBe("session-1");
    expect(session.issuedAtMs).toBe(now());
  });

  it("denies replay: a single-use token cannot be redeemed twice", async () => {
    const auth = makeAuth();
    const token = tokenFor("ea-123");
    await auth.admit(token);
    await expect(auth.admit(token)).rejects.toBeInstanceOf(TokenAlreadyUsedError);
  });

  it("does not consume the token when the signature is invalid", async () => {
    const auth = makeAuth();
    await expect(auth.admit("garbage.token")).rejects.toBeInstanceOf(
      InvalidExamTokenError,
    );
  });

  it("rejects an expired token", async () => {
    const auth = makeAuth();
    const expired = tokenFor("ea-123", { exp: nowS - 1 });
    await expect(auth.admit(expired)).rejects.toBeInstanceOf(ExpiredExamTokenError);
  });

  it("binds distinct tokens to their own attempts", async () => {
    const auth = makeAuth();
    const a = await auth.admit(tokenFor("ea-A"));
    const b = await auth.admit(tokenFor("ea-B"));
    expect(a.examAttemptId).toBe("ea-A");
    expect(b.examAttemptId).toBe("ea-B");
  });
});

describe("tokenCandidateAuthenticator.resume", () => {
  it("remembers an admitted session across a reload (lookup by id)", async () => {
    const auth = makeAuth();
    const session = await auth.admit(tokenFor("ea-123"));

    const resumed = await auth.resume(session.sessionId);
    expect(resumed).toEqual(session);
  });

  it("returns null for an unknown session id", async () => {
    const auth = makeAuth();
    expect(await auth.resume("nope")).toBeNull();
  });
});
