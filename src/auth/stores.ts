/**
 * State ports the candidate authenticator depends on, with in-memory adapters
 * for the demo and tests. A real deployment swaps in Prisma-backed adapters
 * (persistence layer) without touching the authenticator — the seam is the
 * interface, not the implementation.
 */

/** A candidate's authenticated session, bound to exactly one ExamAttempt. */
export interface CandidateSession {
  readonly sessionId: string;
  readonly examAttemptId: string;
  readonly candidateId: string;
  /** When the session was minted, epoch ms. */
  readonly issuedAtMs: number;
}

/** Tracks single-use token ids so a token can never be redeemed twice. */
export interface ConsumedTokenStore {
  /** Atomically claim a jti. Returns true if newly consumed, false if already used. */
  consume(jti: string): Promise<boolean>;
}

/** Persists candidate sessions so an admitted candidate is remembered across reloads. */
export interface CandidateSessionStore {
  save(session: CandidateSession): Promise<void>;
  findById(sessionId: string): Promise<CandidateSession | null>;
}

export function createInMemoryConsumedTokenStore(): ConsumedTokenStore {
  const used = new Set<string>();
  return {
    async consume(jti: string): Promise<boolean> {
      if (used.has(jti)) return false;
      used.add(jti);
      return true;
    },
  };
}

export function createInMemoryCandidateSessionStore(): CandidateSessionStore {
  const sessions = new Map<string, CandidateSession>();
  return {
    async save(session: CandidateSession): Promise<void> {
      sessions.set(session.sessionId, session);
    },
    async findById(sessionId: string): Promise<CandidateSession | null> {
      return sessions.get(sessionId) ?? null;
    },
  };
}
