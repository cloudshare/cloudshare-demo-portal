import { describe, it, expect } from "vitest";
import { computeStepStatuses, DEMO_STEPS, type DemoGates, type DemoStep } from "./demo-control";

function makeGates(overrides: Partial<DemoGates> = {}): DemoGates {
  return {
    examAttemptExists: false,
    labLaunchExists: false,
    environmentStatus: null,
    completedSteps: new Set<DemoStep>(),
    ...overrides,
  };
}

describe("computeStepStatuses", () => {
  it("initial state: only book_exam is available, all others pending", () => {
    const s = computeStepStatuses(makeGates());
    expect(s.book_exam).toBe("available");
    expect(s.launch_lab).toBe("pending");
    expect(s.suspend_exam).toBe("pending");
    expect(s.resume_exam).toBe("pending");
    expect(s.retrieve_score).toBe("pending");
  });

  it("every step key is present in the result", () => {
    const s = computeStepStatuses(makeGates());
    for (const step of DEMO_STEPS) {
      expect(s).toHaveProperty(step);
    }
  });

  it("after book_exam completed: book_exam done, launch_lab available", () => {
    const s = computeStepStatuses(
      makeGates({ examAttemptExists: true, completedSteps: new Set(["book_exam"]) }),
    );
    expect(s.book_exam).toBe("done");
    expect(s.launch_lab).toBe("available");
    expect(s.suspend_exam).toBe("pending");
  });

  it("launch_lab is available whenever examAttempt exists, even if completedSteps is empty", () => {
    const s = computeStepStatuses(makeGates({ examAttemptExists: true }));
    expect(s.launch_lab).toBe("available");
  });

  it("after launch_lab completed: launch_lab done, suspend_exam pending when env null", () => {
    const s = computeStepStatuses(
      makeGates({
        examAttemptExists: true,
        labLaunchExists: true,
        environmentStatus: null,
        completedSteps: new Set(["book_exam", "launch_lab"]),
      }),
    );
    expect(s.launch_lab).toBe("done");
    expect(s.suspend_exam).toBe("pending");
  });

  it("suspend_exam available when lab launched and environment is running", () => {
    const s = computeStepStatuses(
      makeGates({
        examAttemptExists: true,
        labLaunchExists: true,
        environmentStatus: "running",
        completedSteps: new Set(["book_exam", "launch_lab"]),
      }),
    );
    expect(s.suspend_exam).toBe("available");
  });

  it("suspend_exam unavailable while environment is still null, even after launch", () => {
    const s = computeStepStatuses(
      makeGates({
        labLaunchExists: true,
        environmentStatus: null,
        completedSteps: new Set<DemoStep>(["book_exam", "launch_lab"]),
      }),
    );
    expect(s.suspend_exam).toBe("pending");
  });

  it("after suspend_exam completed: done, resume_exam available when env suspended", () => {
    const s = computeStepStatuses(
      makeGates({
        examAttemptExists: true,
        labLaunchExists: true,
        environmentStatus: "suspended",
        completedSteps: new Set(["book_exam", "launch_lab", "suspend_exam"]),
      }),
    );
    expect(s.suspend_exam).toBe("done");
    expect(s.resume_exam).toBe("available");
  });

  it("resume_exam is pending if suspend_exam not in completedSteps even if env is suspended", () => {
    const s = computeStepStatuses(
      makeGates({
        labLaunchExists: true,
        environmentStatus: "suspended",
        completedSteps: new Set<DemoStep>(),
      }),
    );
    expect(s.resume_exam).toBe("pending");
  });

  it("after resume_exam completed: done, retrieve_score available", () => {
    const s = computeStepStatuses(
      makeGates({
        examAttemptExists: true,
        labLaunchExists: true,
        environmentStatus: "running",
        completedSteps: new Set([
          "book_exam",
          "launch_lab",
          "suspend_exam",
          "resume_exam",
        ]),
      }),
    );
    expect(s.resume_exam).toBe("done");
    expect(s.retrieve_score).toBe("available");
  });

  it("retrieve_score pending until resume_exam is done", () => {
    const s = computeStepStatuses(
      makeGates({
        labLaunchExists: true,
        environmentStatus: "running",
        completedSteps: new Set(["book_exam", "launch_lab", "suspend_exam"] as DemoStep[]),
      }),
    );
    expect(s.retrieve_score).toBe("pending");
  });

  it("full happy path: all steps done", () => {
    const s = computeStepStatuses(
      makeGates({
        examAttemptExists: true,
        labLaunchExists: true,
        environmentStatus: "running",
        completedSteps: new Set([
          "book_exam",
          "launch_lab",
          "suspend_exam",
          "resume_exam",
          "retrieve_score",
        ]),
      }),
    );
    for (const step of DEMO_STEPS) {
      expect(s[step]).toBe("done");
    }
  });
});
