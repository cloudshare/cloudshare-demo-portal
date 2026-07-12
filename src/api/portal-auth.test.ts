import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { createPortalAuthenticator, hashPassword } from "@/auth";
import {
  createInMemoryPortalSessionStore,
  createInMemoryPortalUserStore,
} from "@/auth";
import {
  buildPortalLoginDeps,
  buildPortalLogoutDeps,
  buildPortalSessionDeps,
  handleGetPortalSession,
  handlePortalLogin,
  handlePortalLogout,
  type PortalLoginServices,
  type PortalLogoutServices,
  type PortalSessionServices,
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
  it("maps portal login dependencies from composed portal services", async () => {
    const deps = await makeDeps();
    const portalUsers = createInMemoryPortalUserStore([]);
    const diagnosticRecorder = { record: vi.fn(async () => undefined) };
    const services = {
      portalAuth: deps.portalAuth,
      diagnosticRecorder,
      portalUsers,
    } satisfies PortalLoginServices;

    expect(buildPortalLoginDeps(services)).toEqual({
      portalAuth: services.portalAuth,
      diagnostics: diagnosticRecorder,
      users: portalUsers,
    });
  });

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
        workspace: "certification",
      },
    });
  });

  it("records append-only Customer-scoped audit evidence for a successful admin login", async () => {
    const deps = await makeDeps();
    const audit = { write: vi.fn().mockResolvedValue(undefined) };

    await handlePortalLogin({ ...deps, audit: audit as never }, {
      body: { email: "admin@helioscx.demo", password: "correct-horse-battery-staple" },
    });

    expect(audit.write).toHaveBeenCalledWith(expect.objectContaining({
      customerId: "customer-helios", actorEmail: "admin@helioscx.demo", action: "portal.login",
      outcome: "success", details: { role: "admin", workspace: "certification" },
    }));
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
  it("maps portal session dependencies from composed portal services", async () => {
    const deps = await makeDeps();
    const services = {
      portalAuth: deps.portalAuth,
    } satisfies PortalSessionServices;

    expect(buildPortalSessionDeps(services)).toEqual({
      portalAuth: services.portalAuth,
    });
  });

  it("keeps the session route from inlining portal auth wiring", () => {
    const routeSource = readFileSync("app/api/auth/session/route.ts", "utf8");

    expect(routeSource).toContain("buildPortalSessionDeps");
    expect(routeSource).not.toContain("portalAuth: services.portalAuth");
  });

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
        workspace: "certification",
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

  it("builds candidate logout runtime wiring from composed portal services", async () => {
    const deps = await makeDeps("candidate");
    const diagnosticRecorder = { record: vi.fn(async () => undefined) };
    const buildRuntimeDeps = vi.fn(() => ({ runtime: "deps" }));
    const suspendRunningLabs = vi.fn(async () => undefined);
    const services = {
      portalAuth: deps.portalAuth,
      diagnosticRecorder,
      environmentController: {} as never,
      environmentSource: {} as never,
      examClock: {} as never,
      exams: {} as never,
      examAttempts: {} as never,
      labLaunches: {} as never,
      logger: {} as never,
      eventLog: {} as never,
      cloudshareConnections: {} as never,
      cloudshareClientFactory: {} as never,
      heartbeatAutoSuspend: {} as never,
      audit: {} as never,
    } satisfies PortalLogoutServices;
    const login = await handlePortalLogin(deps, {
      body: {
        email: "candidate@helioscx.demo",
        password: "correct-horse-battery-staple",
      },
    });

    const logoutDeps = buildPortalLogoutDeps(services, {
      buildCandidateLogoutAutoSuspendDeps: buildRuntimeDeps as never,
      suspendCandidateRunningLabsForLogout: suspendRunningLabs as never,
    });

    expect(logoutDeps.portalAuth).toBe(services.portalAuth);
    expect(logoutDeps.diagnostics).toBe(diagnosticRecorder);

    await logoutDeps.onCandidateLogout?.(login.session!);

    expect(buildRuntimeDeps).toHaveBeenCalledWith(services, login.session);
    expect(suspendRunningLabs).toHaveBeenCalledWith({ runtime: "deps" }, login.session);
  });
});
