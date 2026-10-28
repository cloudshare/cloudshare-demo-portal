import { expect, it } from "vitest";
import { createInMemoryExamAttemptRepository } from "./exam-attempt-repository";

it("claims only one Customer-scoped runtime command and keeps it across ordinary attempt saves", async () => {
  const attempts = createInMemoryExamAttemptRepository();
  const attempt = { id: "attempt", customerId: "customer", candidateId: "candidate", examId: "exam", status: "in_progress" as const, createdAt: new Date() };
  await attempts.save(attempt);
  const command = { examAttemptId: "attempt", customerId: "customer", commandId: "command", action: "suspend" as const, environmentId: "EN-exact" };
  expect(await attempts.claimRuntimeCommand!({ ...command, customerId: "foreign" }, "in_progress")).toBe(false);
  expect(await Promise.all([attempts.claimRuntimeCommand!(command, "in_progress"), attempts.claimRuntimeCommand!({ ...command, commandId: "other" }, "in_progress")])).toEqual([true, false]);
  await attempts.save(attempt);
  expect(await attempts.readRuntimeCommand!("customer", "attempt")).toEqual({ ...command, phase: "dispatching" });
  expect(await attempts.readRuntimeCommand!("foreign", "attempt")).toBeNull();
});

it("settles only the matching command with the clock and never resurrects terminal attempts", async () => {
  const { createInMemoryExamClockRepository } = await import("@/domain/exam-clock");
  const clocks = createInMemoryExamClockRepository();
  const attempts = createInMemoryExamAttemptRepository(clocks);
  const at = new Date("2026-10-26T10:10:00Z");
  const attempt = { id: "attempt", customerId: "customer", candidateId: "candidate", examId: "exam", status: "in_progress" as const, createdAt: at };
  await attempts.save(attempt);
  await clocks.save({ examAttemptId: "attempt", status: "running", elapsedAtPauseMs: 120000, startedAt: new Date("2026-10-26T10:09:00Z"), updatedAt: at });
  const command = { examAttemptId: "attempt", customerId: "customer", commandId: "command", action: "suspend" as const, environmentId: "EN-exact" };
  await attempts.claimRuntimeCommand!(command, "in_progress");
  expect(await attempts.settleRuntimeCommand!(command, at)).toBe(false);
  expect(await attempts.finishRuntimeCommandDispatch!({ ...command, commandId: "stale" })).toBe(false);
  expect(await attempts.finishRuntimeCommandDispatch!(command)).toBe(true);
  expect(await attempts.settleRuntimeCommand!({ ...command, commandId: "stale" }, at)).toBe(false);
  expect(await attempts.settleRuntimeCommand!(command, at)).toBe(true);
  expect(await attempts.findById("attempt")).toMatchObject({ status: "suspended" });
  expect(await clocks.findByExamAttemptId("attempt")).toMatchObject({ status: "paused", elapsedAtPauseMs: 180000, startedAt: null });
  expect(await attempts.readRuntimeCommand!("customer", "attempt")).toBeNull();
  const resume = { ...command, action: "resume" as const, commandId: "resume" };
  await attempts.claimRuntimeCommand!(resume, "suspended");
  await attempts.finishRuntimeCommandDispatch!(resume);
  await attempts.save({ ...attempt, status: "completed" });
  expect(await attempts.settleRuntimeCommand!(resume, at)).toBe(false);
  expect(await clocks.findByExamAttemptId("attempt")).toMatchObject({ status: "paused", elapsedAtPauseMs: 180000 });
});

it("serializes competing settlements and ordinary terminal saves", async () => {
  const attempts = createInMemoryExamAttemptRepository();
  const at = new Date("2026-10-26T10:10:00Z");
  const attempt = { id: "race", customerId: "customer", candidateId: "candidate", examId: "exam", status: "suspended" as const, createdAt: at };
  const command = { examAttemptId: "race", customerId: "customer", commandId: "resume", action: "resume" as const, environmentId: "EN-exact" };
  await attempts.save(attempt);
  await attempts.claimRuntimeCommand!(command, "suspended");
  await attempts.finishRuntimeCommandDispatch!(command);
  expect(await Promise.all([attempts.settleRuntimeCommand!(command, at), attempts.settleRuntimeCommand!(command, at)])).toEqual([true, false]);
  await attempts.save(attempt);
  await attempts.claimRuntimeCommand!(command, "suspended");
  await attempts.finishRuntimeCommandDispatch!(command);
  const settlement = attempts.settleRuntimeCommand!(command, at);
  await Promise.resolve();
  await attempts.save({ ...attempt, status: "completed" });
  await settlement;
  expect(await attempts.findById("race")).toMatchObject({ status: "completed" });
});
