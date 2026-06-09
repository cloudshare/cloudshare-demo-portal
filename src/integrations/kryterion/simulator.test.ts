import { describe, it, expect } from "vitest";
import { createKryterionSimulator } from "./simulator";
import { verifyExamToken } from "@/auth/exam-token";
import type { KryterionTimerState } from "./simulator";

const secret = "kryterion-secret";
const nowS = 1_000_000;

function makeSim(overrides = {}) {
  let n = 0;
  return createKryterionSimulator({
    secret,
    ttlSeconds: 60,
    now: () => nowS * 1000,
    newJti: () => `jti-${++n}`,
    ...overrides,
  });
}

describe("kryterionSimulator.mintExamToken", () => {
  it("mints a token the auth layer accepts, bound to the given ExamAttempt", () => {
    const sim = makeSim();
    const token = sim.mintExamToken({ examAttemptId: "ea-77", candidateId: "cand-3" });

    const claims = verifyExamToken(token, { secret, now: () => nowS * 1000 });
    expect(claims.examAttemptId).toBe("ea-77");
    expect(claims.candidateId).toBe("cand-3");
  });

  it("sets a short TTL: iat = now, exp = now + ttlSeconds", () => {
    const sim = makeSim();
    const token = sim.mintExamToken({ examAttemptId: "ea-1", candidateId: "c-1" });
    const claims = verifyExamToken(token, { secret, now: () => nowS * 1000 });
    expect(claims.iat).toBe(nowS);
    expect(claims.exp).toBe(nowS + 60);
  });

  it("mints a unique single-use jti per call", () => {
    const sim = makeSim();
    const t1 = sim.mintExamToken({ examAttemptId: "ea-1", candidateId: "c-1" });
    const t2 = sim.mintExamToken({ examAttemptId: "ea-1", candidateId: "c-1" });
    const c1 = verifyExamToken(t1, { secret, now: () => nowS * 1000 });
    const c2 = verifyExamToken(t2, { secret, now: () => nowS * 1000 });
    expect(c1.jti).not.toBe(c2.jti);
  });
});

describe("kryterionSimulator timer", () => {
  it("returns null for an exam attempt the timer has never seen", () => {
    const sim = makeSim();
    expect(sim.getTimerState("ea-unknown")).toBeNull();
  });

  it("pauseTimer sets the timer to paused state", async () => {
    const sim = makeSim();
    await sim.pauseTimer("ea-1");
    const state = sim.getTimerState("ea-1") as KryterionTimerState;
    expect(state.status).toBe("paused");
  });

  it("resumeTimer sets the timer to running state", async () => {
    const sim = makeSim();
    await sim.resumeTimer("ea-1");
    const state = sim.getTimerState("ea-1") as KryterionTimerState;
    expect(state.status).toBe("running");
  });

  it("pause then resume cycles correctly", async () => {
    const sim = makeSim();
    await sim.pauseTimer("ea-1");
    expect(sim.getTimerState("ea-1")?.status).toBe("paused");
    await sim.resumeTimer("ea-1");
    expect(sim.getTimerState("ea-1")?.status).toBe("running");
  });

  it("banks elapsed time at pause so it accumulates across multiple cycles", async () => {
    let t = 0;
    const sim = createKryterionSimulator({ secret, ttlSeconds: 60, now: () => t });

    t = 0;
    await sim.resumeTimer("ea-1"); // start at t=0

    t = 1_000;
    await sim.pauseTimer("ea-1"); // 1 s elapsed → elapsedAtPause = 1000

    const paused = sim.getTimerState("ea-1") as KryterionTimerState;
    expect(paused.elapsedAtPause).toBe(1_000);

    t = 2_000;
    await sim.resumeTimer("ea-1"); // resumes; startedAt = 2000

    t = 3_500;
    await sim.pauseTimer("ea-1"); // 1.5 s more → total = 2500

    const paused2 = sim.getTimerState("ea-1") as KryterionTimerState;
    expect(paused2.elapsedAtPause).toBe(2_500);
  });

  it("isolates timers per exam attempt", async () => {
    const sim = makeSim();
    await sim.pauseTimer("ea-1");
    await sim.resumeTimer("ea-2");
    expect(sim.getTimerState("ea-1")?.status).toBe("paused");
    expect(sim.getTimerState("ea-2")?.status).toBe("running");
    expect(sim.getTimerState("ea-3")).toBeNull();
  });

  it("double-resume banks elapsed time so no ticks are lost (idempotent retry safety)", async () => {
    let t = 0;
    const sim = createKryterionSimulator({ secret, ttlSeconds: 60, now: () => t });

    t = 0;
    await sim.resumeTimer("ea-1"); // start at t=0

    t = 1_000;
    await sim.resumeTimer("ea-1"); // already running — banks 1 s, resets startedAt=1000

    const state = sim.getTimerState("ea-1") as KryterionTimerState;
    // elapsedAtPause should now hold the 1 s banked during the double-resume
    expect(state.elapsedAtPause).toBe(1_000);
    expect(state.status).toBe("running");

    t = 2_000;
    await sim.pauseTimer("ea-1"); // 1 s more → total = 2000
    expect(sim.getTimerState("ea-1")?.elapsedAtPause).toBe(2_000);
  });
});
