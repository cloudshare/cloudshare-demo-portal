import { randomUUID } from "node:crypto";
import { TokenAlreadyUsedError } from "./errors";
import { verifyExamToken } from "./exam-token";
import type {
  CandidateSession,
  CandidateSessionStore,
  ConsumedTokenStore,
} from "./stores";

/**
 * The candidate authentication seam. Other layers admit and resume candidates
 * only through this interface, so the token-based implementation here can be
 * swapped for a real IdP/OIDC without changing callers.
 */
export interface CandidateAuthenticator {
  /**
   * Validate a single-use exam token and mint a session bound to its ExamAttempt.
   * Throws an {@link import("./errors").AuthError} subclass if the token is
   * invalid, expired, or already used.
   */
  admit(token: string): Promise<CandidateSession>;
  /** Re-load a previously minted session by id (survives a page reload). */
  resume(sessionId: string): Promise<CandidateSession | null>;
}

export interface TokenAuthenticatorOptions {
  /** HMAC secret the Kryterion simulator signs tokens with. */
  readonly secret: string;
  readonly consumedTokens: ConsumedTokenStore;
  readonly sessions: CandidateSessionStore;
  /** Current time, epoch ms. Injectable for tests. Defaults to `Date.now`. */
  readonly now?: () => number;
  /** Session id generator. Injectable for tests. Defaults to a random UUID. */
  readonly newSessionId?: () => string;
}

export function createTokenCandidateAuthenticator(
  opts: TokenAuthenticatorOptions,
): CandidateAuthenticator {
  const now = opts.now ?? Date.now;
  const newSessionId = opts.newSessionId ?? (() => randomUUID());

  return {
    async admit(token: string): Promise<CandidateSession> {
      // 1. Signature, schema, expiry. Throws before any state changes, so a bad
      //    token never consumes a jti.
      const claims = verifyExamToken(token, { secret: opts.secret, now });

      // 2. Atomically claim the single-use token; reject replays.
      const fresh = await opts.consumedTokens.consume(claims.jti);
      if (!fresh) {
        throw new TokenAlreadyUsedError("Exam token has already been used", {
          jti: claims.jti,
          examAttemptId: claims.examAttemptId,
        });
      }

      // 3. Mint a session bound to exactly this ExamAttempt.
      const session: CandidateSession = {
        sessionId: newSessionId(),
        examAttemptId: claims.examAttemptId,
        candidateId: claims.candidateId,
        issuedAtMs: now(),
      };
      await opts.sessions.save(session);
      return session;
    },

    async resume(sessionId: string): Promise<CandidateSession | null> {
      return opts.sessions.findById(sessionId);
    },
  };
}
