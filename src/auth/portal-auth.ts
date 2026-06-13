import { randomUUID } from "node:crypto";
import type {
  PortalSession,
  PortalSessionStore,
  PortalUserStore,
} from "./portal-stores";
import { verifyPassword } from "./password";

export class InvalidPortalCredentialsError extends Error {
  constructor(message = "Invalid email or password") {
    super(message);
    this.name = "InvalidPortalCredentialsError";
  }
}

export interface PortalAuthenticator {
  signIn(email: string, password: string): Promise<PortalSession>;
  resume(sessionId: string): Promise<PortalSession | null>;
}

export interface PortalAuthenticatorOptions {
  readonly users: PortalUserStore;
  readonly sessions: PortalSessionStore;
  readonly now?: () => number;
  readonly newSessionId?: () => string;
}

export function createPortalAuthenticator(
  opts: PortalAuthenticatorOptions,
): PortalAuthenticator {
  const now = opts.now ?? Date.now;
  const newSessionId = opts.newSessionId ?? (() => randomUUID());

  return {
    async signIn(email: string, password: string): Promise<PortalSession> {
      const user = await opts.users.findByEmail(email);
      if (!user) {
        throw new InvalidPortalCredentialsError();
      }

      const ok = await verifyPassword(password, user.passwordHash);
      if (!ok) {
        throw new InvalidPortalCredentialsError();
      }

      const session: PortalSession = {
        sessionId: newSessionId(),
        userId: user.id,
        customerId: user.customerId,
        role: user.role,
        email: user.email,
        issuedAtMs: now(),
      };
      await opts.sessions.save(session);
      return session;
    },

    async resume(sessionId: string): Promise<PortalSession | null> {
      return opts.sessions.findById(sessionId);
    },
  };
}
