import { describe, expect, it, vi } from "vitest";
import { createPortalAuthenticator, hashPassword } from "@/auth";
import {
  createInMemoryPortalSessionStore,
  createInMemoryPortalUserStore,
} from "@/auth";
import {
  handleGetPortalSession,
  handlePortalLogin,
  handlePortalLogout,
} from "./portal-auth";

async function makeDeps(role: "admin" | "candidate" = "admin") {
  const passwordHash = await hashPassword("correct-horse-battery-staple");
  let currentTime = 1_700_000_000_000;
  const email = role === "admin" ? "admin@helioscx.demo" : "candidate@helioscx.demo";
  return {
    advanceTime(ms: number) {
      currentTime += ms;
    },
    portalAuth: createPortalAuthenticator({
      users: createInMemoryPortalUserStore([
        {
          id: "user-1",
          customerId: "customer-helios",
          email,
          passwordHash,
          role,
        },
      ]),
      sessions: createInMemoryPortalSessionStore(),
      now: () => currentTime,
      newSessionId: () => "portal-session-1",
      sessionTtlMs: 60_000,
    }),
  };
}

describe("handlePortalLogin", () => {
  it("logs the Helios admin in and returns session details", async () => {
    const deps = await makeDeps();

    const response = await handlePortalLogin(deps, {
      body: {
        email: "admin@helioscx.demo",
        password: "correct-horse-battery-staple",
      },
    });

    expect(response.status).toBe(200);
    expect(response.session?.sessionId).toBe("portal-session-1");
    expect(response.body).toEqual({
      session: {
        email: "admin@helioscx.demo",
        role: "admin",
        customerId: "customer-helios",
      },
    });
  });

  it("rejects bad credentials without leaking internals", async () => {
    const deps = await makeDeps();

    const response = await handlePortalLogin(deps, {
      body: {
        email: "admin@helioscx.demo",
        password: "wrong-password",
      },
    });

    expect(response.status).toBe(401);
    expect(response.body).toEqual({ error: "Invalid email or password" });
  });
});

describe("handleGetPortalSession", () => {
  it("resumes a previously minted portal session", async () => {
    const deps = await makeDeps();
    const login = await handlePortalLogin(deps, {
      body: {
        email: "admin@helioscx.demo",
        password: "correct-horse-battery-staple",
      },
    });

    const response = await handleGetPortalSession(deps, {
      sessionId: login.session?.sessionId,
    });

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      session: {
        email: "admin@helioscx.demo",
        role: "admin",
        customerId: "customer-helios",
      },
    });
  });

  it("returns 401 for an expired portal session", async () => {
    const deps = await makeDeps();
    const login = await handlePortalLogin(deps, {
      body: {
        email: "admin@helioscx.demo",
        password: "correct-horse-battery-staple",
      },
    });

    deps.advanceTime(60_001);

    const response = await handleGetPortalSession(deps, {
      sessionId: login.session?.sessionId,
    });

    expect(response.status).toBe(401);
    expect(response.body).toEqual({ error: "no portal session" });
  });

  it("signs the current portal session out", async () => {
    const deps = await makeDeps();
    const login = await handlePortalLogin(deps, {
      body: {
        email: "admin@helioscx.demo",
        password: "correct-horse-battery-staple",
      },
    });

    const logout = await handlePortalLogout(deps, {
      sessionId: login.session?.sessionId,
    });

    expect(logout.status).toBe(200);
    expect(logout.body).toEqual({ ok: true });

    const resumed = await handleGetPortalSession(deps, {
      sessionId: login.session?.sessionId,
    });
    expect(resumed.status).toBe(401);
    expect(resumed.body).toEqual({ error: "no portal session" });
  });

  it("runs candidate logout cleanup before invalidating the session", async () => {
    const deps = await makeDeps("candidate");
    const cleanupOrder: string[] = [];
    const onCandidateLogout = vi.fn(async () => {
      cleanupOrder.push("cleanup");
      const stillResumable = await handleGetPortalSession(deps, {
        sessionId: "portal-session-1",
      });
      expect(stillResumable.status).toBe(200);
    });
    const login = await handlePortalLogin(deps, {
      body: {
        email: "candidate@helioscx.demo",
        password: "correct-horse-battery-staple",
      },
    });

    const logout = await handlePortalLogout(
      { ...deps, onCandidateLogout },
      { sessionId: login.session?.sessionId },
    );

    cleanupOrder.push("after-logout");
    expect(logout.status).toBe(200);
    expect(onCandidateLogout).toHaveBeenCalledWith(
      expect.objectContaining({
        role: "candidate",
        userId: "user-1",
        email: "candidate@helioscx.demo",
      }),
    );
    expect(cleanupOrder).toEqual(["cleanup", "after-logout"]);

    const resumed = await handleGetPortalSession(deps, {
      sessionId: login.session?.sessionId,
    });
    expect(resumed.status).toBe(401);
  });

  it("does not run candidate logout cleanup for admins", async () => {
    const deps = await makeDeps("admin");
    const onCandidateLogout = vi.fn();
    const login = await handlePortalLogin(deps, {
      body: {
        email: "admin@helioscx.demo",
        password: "correct-horse-battery-staple",
      },
    });

    await handlePortalLogout(
      { ...deps, onCandidateLogout },
      { sessionId: login.session?.sessionId },
    );

    expect(onCandidateLogout).not.toHaveBeenCalled();
  });
});
