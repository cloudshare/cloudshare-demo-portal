import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  mockResumeExamAttemptRuntime,
  mockRunHeartbeatAutoSuspendRuntime,
  mockSuspendExamAttemptRuntime,
} = vi.hoisted(() => ({
  mockResumeExamAttemptRuntime: vi.fn(),
  mockRunHeartbeatAutoSuspendRuntime: vi.fn(),
  mockSuspendExamAttemptRuntime: vi.fn(),
}));

vi.mock("./exam-attempt-suspend-resume-runtime", () => ({
  resumeExamAttemptRuntime: mockResumeExamAttemptRuntime,
  runHeartbeatAutoSuspendRuntime: mockRunHeartbeatAutoSuspendRuntime,
  suspendExamAttemptRuntime: mockSuspendExamAttemptRuntime,
}));

import {
  handleResumeExam,
  handleSuspendExam,
  runHeartbeatAutoSuspend,
  type ResumeHandlerDeps,
  type SuspendHandlerDeps,
} from "./suspend-resume";

describe("suspend/resume HTTP-shaped adapter", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("rejects invalid suspend bodies before calling the runtime", async () => {
    await expect(handleSuspendExam({} as SuspendHandlerDeps, { body: null })).resolves.toEqual({
      status: 400,
      body: { error: "examAttemptId is required" },
    });
    await expect(handleSuspendExam({} as SuspendHandlerDeps, { body: {} })).resolves.toEqual({
      status: 400,
      body: { error: "examAttemptId is required" },
    });
    await expect(
      handleSuspendExam({} as SuspendHandlerDeps, { body: { examAttemptId: "  " } }),
    ).resolves.toEqual({
      status: 400,
      body: { error: "examAttemptId is required" },
    });
    expect(mockSuspendExamAttemptRuntime).not.toHaveBeenCalled();
  });

  it("trims a valid suspend examAttemptId and delegates to the runtime", async () => {
    mockSuspendExamAttemptRuntime.mockResolvedValue({
      status: 200,
      body: { status: "suspended", examAttemptId: "ea-1" },
    });

    const response = await handleSuspendExam({} as SuspendHandlerDeps, {
      body: { examAttemptId: " ea-1 " },
    });

    expect(response.status).toBe(200);
    expect(mockSuspendExamAttemptRuntime).toHaveBeenCalledWith(
      expect.anything(),
      { examAttemptId: "ea-1" },
    );
  });

  it("rejects invalid resume bodies before calling the runtime", async () => {
    await expect(handleResumeExam({} as ResumeHandlerDeps, { body: "bad" })).resolves.toEqual({
      status: 400,
      body: { error: "examAttemptId is required" },
    });
    await expect(
      handleResumeExam({} as ResumeHandlerDeps, { body: { examAttemptId: "" } }),
    ).resolves.toEqual({
      status: 400,
      body: { error: "examAttemptId is required" },
    });
    expect(mockResumeExamAttemptRuntime).not.toHaveBeenCalled();
  });

  it("coalesces concurrent duplicate resume requests into one runtime transition", async () => {
    const release: { current?: () => void } = {};
    mockResumeExamAttemptRuntime.mockImplementation(
      () =>
        new Promise((resolve) => {
          release.current = () =>
            resolve({
              status: 200,
              body: { status: "resumed", examAttemptId: "ea-1" },
            });
        }),
    );

    const first = handleResumeExam({} as ResumeHandlerDeps, {
      body: { examAttemptId: "ea-1" },
    });
    const second = handleResumeExam({} as ResumeHandlerDeps, {
      body: { examAttemptId: "ea-1" },
    });

    await vi.waitFor(() => {
      expect(mockResumeExamAttemptRuntime).toHaveBeenCalledTimes(1);
    });
    release.current?.();

    await expect(first).resolves.toEqual({
      status: 200,
      body: { status: "resumed", examAttemptId: "ea-1" },
    });
    await expect(second).resolves.toEqual({
      status: 200,
      body: { status: "resumed", examAttemptId: "ea-1" },
    });
  });

  it("delegates heartbeat auto-suspend to the runtime module", async () => {
    mockRunHeartbeatAutoSuspendRuntime.mockResolvedValue(undefined);

    await expect(
      runHeartbeatAutoSuspend({} as SuspendHandlerDeps, "ea-1"),
    ).resolves.toBeUndefined();

    expect(mockRunHeartbeatAutoSuspendRuntime).toHaveBeenCalledWith(
      expect.anything(),
      "ea-1",
    );
  });
});
