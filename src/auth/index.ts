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
  createPortalAuthenticator,
  DEFAULT_PORTAL_SESSION_TTL_MS,
  InvalidPortalCredentialsError,
  type PortalAuthenticator,
  type PortalAuthenticatorOptions,
} from "./portal-auth";
export {
  type PortalSession,
  type PortalCustomerRecord,
  type PortalSessionStore,
  type CreatePortalUserInput,
  type PortalUserRecord,
  type PortalUserRole,
  type PortalUserProvisioningStore,
  type PortalUserStore,
  createInMemoryPortalSessionStore,
  createInMemoryPortalUserStore,
} from "./portal-stores";
export { hashPassword, verifyPassword } from "./password";
export {
  PortalCustomerNotFoundError,
  PortalRegistrationValidationError,
  PortalUserAlreadyExistsError,
  registerCandidate,
  type PortalCandidateRegistrationDeps,
  type RegisterCandidateInput,
} from "./portal-registration";
export {
  verifyExamToken,
  examTokenClaimsSchema,
  type ExamTokenClaims,
} from "./exam-token";
