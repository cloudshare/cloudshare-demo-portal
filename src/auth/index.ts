/** Public surface of the active portal auth layer. */

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
  type PortalCustomerWorkspace,
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
