import { randomUUID } from "node:crypto";
import { signExamToken } from "@/auth/exam-token";

/**
 * Kryterion simulator. Stands in for the real Kryterion proctoring platform,
 * which mints a short-lived, single-use signed token pinned to one ExamAttempt
 * when a candidate's exam starts. It signs with the same codec the auth layer
 * verifies, so the simulated and real flows are indistinguishable to auth.
 *
 * When Kryterion is integrated for real, this module is replaced by an inbound
 * adapter over Kryterion's actual token/session events — the auth seam is unchanged.
 */

export interface MintExamTokenInput {
  readonly examAttemptId: string;
  readonly candidateId: string;
}

export interface KryterionSimulator {
  /** Mint a signed, single-use token admitting the candidate to one ExamAttempt. */
  mintExamToken(input: MintExamTokenInput): string;
}

export interface KryterionSimulatorOptions {
  /** HMAC secret shared with the auth layer. */
  readonly secret: string;
  /** Token lifetime in seconds (short — exam tokens are redeemed immediately). */
  readonly ttlSeconds: number;
  /** Current time, epoch ms. Injectable for tests. Defaults to `Date.now`. */
  readonly now?: () => number;
  /** Single-use token id generator. Injectable for tests. Defaults to a random UUID. */
  readonly newJti?: () => string;
}

export function createKryterionSimulator(
  opts: KryterionSimulatorOptions,
): KryterionSimulator {
  const now = opts.now ?? Date.now;
  const newJti = opts.newJti ?? (() => randomUUID());

  return {
    mintExamToken({ examAttemptId, candidateId }: MintExamTokenInput): string {
      const iat = Math.floor(now() / 1000);
      return signExamToken(
        {
          jti: newJti(),
          examAttemptId,
          candidateId,
          iat,
          exp: iat + opts.ttlSeconds,
        },
        opts.secret,
      );
    },
  };
}
