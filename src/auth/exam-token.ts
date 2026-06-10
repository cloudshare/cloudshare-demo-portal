import { createHmac, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { ExpiredExamTokenError, InvalidExamTokenError } from "./errors";

/**
 * Compact signed exam token: `base64url(payload).base64url(HMAC-SHA256(payload))`.
 *
 * This is the contract between the Kryterion simulator (which mints tokens when
 * an exam starts) and the auth layer (which verifies them). Keeping mint and
 * verify in one module means the two can never drift. A real OIDC/IdP would
 * replace this module behind the same {@link CandidateAuthenticator} seam.
 *
 * Claims bind the token to exactly one `ExamAttempt` (`examAttemptId`) and carry
 * a unique `jti` so the auth layer can enforce single-use.
 */

export const examTokenClaimsSchema = z.object({
  /** Unique token id — the single-use key. */
  jti: z.string().min(1),
  /** The one ExamAttempt this token admits the candidate to. */
  examAttemptId: z.string().min(1),
  candidateId: z.string().min(1),
  /** Issued-at, epoch seconds. */
  iat: z.number().int().positive(),
  /** Expiry, epoch seconds. */
  exp: z.number().int().positive(),
});

export type ExamTokenClaims = z.infer<typeof examTokenClaimsSchema>;

function sign(encoded: string, secret: string): string {
  return createHmac("sha256", secret).update(encoded).digest("base64url");
}

/** Encode and HMAC-sign claims into a compact token string. */
export function signExamToken(claims: ExamTokenClaims, secret: string): string {
  const encoded = Buffer.from(JSON.stringify(claims)).toString("base64url");
  return `${encoded}.${sign(encoded, secret)}`;
}

export interface VerifyExamTokenOptions {
  readonly secret: string;
  /** Current time in epoch ms. Injectable for tests. Defaults to `Date.now`. */
  readonly now?: () => number;
}

/**
 * Verify signature, schema, and expiry. Throws {@link InvalidExamTokenError} or
 * {@link ExpiredExamTokenError}; returns the claims on success. Does NOT enforce
 * single-use — that is the authenticator's job (it needs a consumed-token store).
 */
export function verifyExamToken(token: string, opts: VerifyExamTokenOptions): ExamTokenClaims {
  const now = opts.now ?? Date.now;

  const parts = token.split(".");
  if (parts.length !== 2 || !parts[0] || !parts[1]) {
    throw new InvalidExamTokenError("Exam token is not in `payload.signature` form");
  }
  const [encoded, providedSig] = parts;

  const expectedSig = sign(encoded, opts.secret);
  const a = Buffer.from(providedSig);
  const b = Buffer.from(expectedSig);
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    throw new InvalidExamTokenError("Exam token signature is invalid");
  }

  let json: unknown;
  try {
    json = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8"));
  } catch {
    throw new InvalidExamTokenError("Exam token payload is not valid JSON");
  }

  const parsed = examTokenClaimsSchema.safeParse(json);
  if (!parsed.success) {
    throw new InvalidExamTokenError("Exam token claims failed validation", {
      issues: parsed.error.issues.map((i) => i.message),
    });
  }

  if (Math.floor(now() / 1000) >= parsed.data.exp) {
    throw new ExpiredExamTokenError("Exam token has expired", {
      exp: parsed.data.exp,
    });
  }

  return parsed.data;
}
