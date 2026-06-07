/**
 * Public surface of the auth layer. Candidate authentication is consumed only
 * through {@link CandidateAuthenticator}; the token codec and stores are exposed
 * for the composition root and for adapters (e.g. Prisma-backed stores).
 */

export * from "./errors";
export {
  createTokenCandidateAuthenticator,
  type CandidateAuthenticator,
  type TokenAuthenticatorOptions,
} from "./authenticator";
export {
  type CandidateSession,
  type ConsumedTokenStore,
  type CandidateSessionStore,
  createInMemoryConsumedTokenStore,
  createInMemoryCandidateSessionStore,
} from "./stores";
export {
  signExamToken,
  verifyExamToken,
  examTokenClaimsSchema,
  type ExamTokenClaims,
} from "./exam-token";
