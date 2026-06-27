import { createHmac, timingSafeEqual } from "node:crypto";
import { z } from "zod";

export class LegacyExamTokenError extends Error {
  constructor(message: string, readonly context?: Record<string, unknown>) {
    super(message);
    this.name = "LegacyExamTokenError";
  }
}

export class InvalidLegacyExamTokenError extends LegacyExamTokenError {
  constructor(message: string, context?: Record<string, unknown>) {
    super(message, context);
    this.name = "InvalidLegacyExamTokenError";
  }
}

export class ExpiredLegacyExamTokenError extends LegacyExamTokenError {
  constructor(message: string, context?: Record<string, unknown>) {
    super(message, context);
    this.name = "ExpiredLegacyExamTokenError";
  }
}

export const legacyExamTokenClaimsSchema = z.object({
  jti: z.string().min(1),
  examAttemptId: z.string().min(1),
  candidateId: z.string().min(1),
  iat: z.number().int().positive(),
  exp: z.number().int().positive(),
});

export type LegacyExamTokenClaims = z.infer<typeof legacyExamTokenClaimsSchema>;

function sign(encoded: string, secret: string): string {
  return createHmac("sha256", secret).update(encoded).digest("base64url");
}

export function signLegacyExamToken(claims: LegacyExamTokenClaims, secret: string): string {
  const encoded = Buffer.from(JSON.stringify(claims)).toString("base64url");
  return `${encoded}.${sign(encoded, secret)}`;
}

export interface VerifyLegacyExamTokenOptions {
  readonly secret: string;
  readonly now?: () => number;
}

export function verifyLegacyExamToken(
  token: string,
  opts: VerifyLegacyExamTokenOptions,
): LegacyExamTokenClaims {
  const now = opts.now ?? Date.now;

  const parts = token.split(".");
  if (parts.length !== 2 || !parts[0] || !parts[1]) {
    throw new InvalidLegacyExamTokenError("Exam token is not in `payload.signature` form");
  }
  const [encoded, providedSig] = parts;

  const expectedSig = sign(encoded, opts.secret);
  const a = Buffer.from(providedSig);
  const b = Buffer.from(expectedSig);
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    throw new InvalidLegacyExamTokenError("Exam token signature is invalid");
  }

  let json: unknown;
  try {
    json = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8"));
  } catch {
    throw new InvalidLegacyExamTokenError("Exam token payload is not valid JSON");
  }

  const parsed = legacyExamTokenClaimsSchema.safeParse(json);
  if (!parsed.success) {
    throw new InvalidLegacyExamTokenError("Exam token claims failed validation", {
      issues: parsed.error.issues.map((issue) => issue.message),
    });
  }

  if (Math.floor(now() / 1000) >= parsed.data.exp) {
    throw new ExpiredLegacyExamTokenError("Exam token has expired", {
      exp: parsed.data.exp,
    });
  }

  return parsed.data;
}
