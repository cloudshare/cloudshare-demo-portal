import { describe, expect, it } from "vitest";
import { createPortalAuthenticator, InvalidPortalCredentialsError } from "./portal-auth";
import { hashPassword } from "./password";
import {
  createInMemoryPortalSessionStore,
  createInMemoryPortalUserStore,
} from "./portal-stores";

const now = () => 1_700_000_000_000;

async function makeAuth() {
  let n = 0;
  const passwordHash = await hashPassword("correct-horse-battery-staple");
  return createPortalAuthenticator({
    users: createInMemoryPortalUserStore([
      {
        id: "user-1",
        customerId: "customer-helios",
        email: "admin@helios.example",
        passwordHash,
        role: "admin",
      },
    ]),
    sessions: createInMemoryPortalSessionStore(),
    now,
    newSessionId: () => `portal-session-${++n}`,
  });
}

describe("portalAuthenticator.signIn", () => {
  it("admits a Helios admin with email/password and persists a resumable session", async () => {
    const auth = await makeAuth();

    const session = await auth.signIn("admin@helios.example", "correct-horse-battery-staple");

    expect(session).toEqual({
      sessionId: "portal-session-1",
      userId: "user-1",
      customerId: "customer-helios",
      role: "admin",
      email: "admin@helios.example",
      issuedAtMs: now(),
    });

    await expect(auth.resume(session.sessionId)).resolves.toEqual(session);
  });

  it("rejects bad credentials with a typed auth error", async () => {
    const auth = await makeAuth();

    await expect(auth.signIn("admin@helios.example", "wrong-password")).rejects.toBeInstanceOf(
      InvalidPortalCredentialsError,
    );
    await expect(auth.signIn("nobody@helios.example", "wrong-password")).rejects.toBeInstanceOf(
      InvalidPortalCredentialsError,
    );
  });
});
