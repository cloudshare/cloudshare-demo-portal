import { describe, it, expect } from "vitest";
import { reconcileEnvironment } from "./environment-reconcile";
import { createInMemoryEnvironmentRepository } from "@/persistence/environment-repository";
import type { EnvironmentStateSnapshot, EnvironmentStateSource } from "./environment";

/** A source whose answers are scripted per call, so a test can model a changing
 *  (or out-of-order) world. */
function scriptedSource(
  answers: (EnvironmentStateSnapshot | null)[],
): EnvironmentStateSource {
  let i = 0;
  return {
    async getEnvironmentState() {
      return answers[Math.min(i++, answers.length - 1)];
    },
  };
}

const snap = (status: EnvironmentStateSnapshot["status"]): EnvironmentStateSnapshot => ({
  environmentExternalId: "env-1",
  status,
});

describe("reconcileEnvironment", () => {
  it("polls the source and persists the current authoritative status", async () => {
    const environments = createInMemoryEnvironmentRepository();
    const deps = {
      source: scriptedSource([snap("running")]),
      environments,
      now: () => new Date("2026-06-08T10:00:00Z"),
    };

    const record = await reconcileEnvironment(deps, "env-1");

    expect(record).toEqual({
      environmentExternalId: "env-1",
      status: "running",
      observedAt: new Date("2026-06-08T10:00:00Z"),
    });
    expect(await environments.findByExternalId("env-1")).toEqual(record);
  });

  it("treats the poll as authoritative, overwriting a stale stored status", async () => {
    const environments = createInMemoryEnvironmentRepository();
    await environments.save({
      environmentExternalId: "env-1",
      status: "suspended",
      observedAt: new Date("2026-06-08T09:00:00Z"),
    });
    const deps = {
      source: scriptedSource([snap("running")]),
      environments,
      now: () => new Date("2026-06-08T10:00:00Z"),
    };

    const record = await reconcileEnvironment(deps, "env-1");

    expect(record?.status).toBe("running");
  });

  it("returns null and persists nothing when the source reports no such environment", async () => {
    const environments = createInMemoryEnvironmentRepository();
    const deps = {
      source: scriptedSource([null]),
      environments,
      now: () => new Date("2026-06-08T10:00:00Z"),
    };

    expect(await reconcileEnvironment(deps, "ghost")).toBeNull();
    expect(await environments.findByExternalId("ghost")).toBeNull();
  });

  it("is out-of-order safe: an older poll never clobbers a newer observation", async () => {
    const environments = createInMemoryEnvironmentRepository();
    // The world is "running" now; a slow, earlier-triggered poll still believes
    // it is "suspended". The earlier poll must not overwrite the newer truth.
    const times = [new Date("2026-06-08T10:00:05Z"), new Date("2026-06-08T10:00:00Z")];
    let t = 0;
    const now = () => times[t++];

    // Newer reconcile lands first and writes the truth.
    await reconcileEnvironment(
      { source: scriptedSource([snap("running")]), environments, now },
      "env-1",
    );
    // Older reconcile (smaller observedAt) lands second with a stale reading.
    await reconcileEnvironment(
      { source: scriptedSource([snap("suspended")]), environments, now },
      "env-1",
    );

    expect((await environments.findByExternalId("env-1"))?.status).toBe("running");
  });
});
