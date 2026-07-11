import { isPortalSessionExpiredStatus } from "./session-expiry";

export const ADMIN_SESSION_EXPIRED_MESSAGE =
  "Your admin session has expired. Sign in again to continue.";

export class AdminSessionExpiredError extends Error {
  constructor() {
    super(ADMIN_SESSION_EXPIRED_MESSAGE);
    this.name = "AdminSessionExpiredError";
  }
}

export function isAdminSessionExpiredStatus(status: number): boolean {
  return isPortalSessionExpiredStatus(status);
}

export function isAdminSessionExpiredError(error: unknown): error is AdminSessionExpiredError {
  return error instanceof AdminSessionExpiredError;
}

export type AdminAuthenticatedRequest = (
  input: RequestInfo | URL,
  init?: RequestInit,
) => Promise<Response>;

export function createAdminAuthenticatedRequest(dependencies: {
  readonly fetchImpl: typeof fetch;
  readonly onSessionExpired: () => void;
}): AdminAuthenticatedRequest {
  return async (input, init) => {
    const response = await dependencies.fetchImpl(input, init);
    if (isAdminSessionExpiredStatus(response.status)) {
      dependencies.onSessionExpired();
      throw new AdminSessionExpiredError();
    }
    return response;
  };
}
