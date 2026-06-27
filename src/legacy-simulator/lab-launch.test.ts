import { describe, expect, it, vi } from "vitest";
import { LabLaunchError, NotEntitledError } from "@/domain/errors";
import type { ExamAttempt } from "@/domain/exam-attempt";
import type { LabProvisioner } from "@/domain/lab-launch";
import { createInMemoryExamAttemptRepository } from "@/persistence/exam-attempt-repository";
import { createInMemoryLabLaunchRepository } from "@/persistence/lab-launch-repository";
import { launchLegacySimulatorLab } from "./lab-launch";

const attempt: ExamAttempt = {
  id: "ea-1",
  candidateId: "c-1",
  examId: "GCP-ASSOC",
  status: "booked",
  createdAt: new Date(0),
};

function provisioner(overrides: Partial<LabProvisioner> = {}): {
  labs: LabProvisioner;
  order: string[];
  createArgs: () => unknown;
} {
  const order: string[] = [];
  let createArgs: unknown;
  const labs: LabProvisioner = {
    async createExperience(input) {
      order.push("createExperience");
      createArgs = input;
      return { experienceId: "exp-1" };
    },
    async addStudent() {
      order.push("addStudent");
    },
    async createSponsoredLink() {
      order.push("createSponsoredLink");
      return { loginUrl: "https://classic.cloudshare.com/login?t=demo" };
    },
    ...overrides,
  };
  return { labs, order, createArgs: () => createArgs };
}

async function setup(labs: LabProvisioner, seed: ExamAttempt | null = attempt) {
  const attempts = createInMemoryExamAttemptRepository();
  if (seed) await attempts.save(seed);
  const launches = createInMemoryLabLaunchRepository();
  let n = 0;
  const deps = {
    attempts,
    labs,
    launches,
    newId: () => `launch-${++n}`,
    newExternalId: () => "env-ext-1",
    now: () => new Date("2026-06-08T00:00:00Z"),
  };
  return { deps, launches };
}

describe("launchLegacySimulatorLab", () => {
  it("provisions in strict order: experience -> add student -> sponsored link", async () => {
    const { labs, order } = provisioner();
    const { deps } = await setup(labs);

    await launchLegacySimulatorLab(deps, { examAttemptId: "ea-1" });

    expect(order).toEqual(["createExperience", "addStudent", "createSponsoredLink"]);
  });

  it("creates the experience as Registered Students Only with a persisted environmentExternalId", async () => {
    const { labs, createArgs } = provisioner();
    const { deps, launches } = await setup(labs);

    const launch = await launchLegacySimulatorLab(deps, { examAttemptId: "ea-1" });

    expect(createArgs()).toMatchObject({
      registeredStudentsOnly: true,
      environmentExternalId: "env-ext-1",
    });
    expect(launch.environmentExternalId).toBe("env-ext-1");
    expect(launch.loginUrl).toBe("https://classic.cloudshare.com/login?t=demo");
    expect(await launches.findByExamAttemptId("ea-1")).toEqual(launch);
  });

  it("recomputes legacy demo entitlement server-side: an unknown attempt is denied", async () => {
    const { labs, order } = provisioner();
    const { deps } = await setup(labs, null);

    await expect(
      launchLegacySimulatorLab(deps, { examAttemptId: "ghost" }),
    ).rejects.toBeInstanceOf(NotEntitledError);
    expect(order).toEqual([]);
  });

  it("denies attempts that are not in the retired booked status", async () => {
    const { labs, order } = provisioner();
    const { deps } = await setup(labs, { ...attempt, status: "scheduled" });

    await expect(
      launchLegacySimulatorLab(deps, { examAttemptId: "ea-1" }),
    ).rejects.toBeInstanceOf(NotEntitledError);
    expect(order).toEqual([]);
  });

  it("returns the existing launch without re-provisioning when one already exists for the attempt", async () => {
    const { labs, order } = provisioner();
    const { deps, launches } = await setup(labs);

    const first = await launchLegacySimulatorLab(deps, { examAttemptId: "ea-1" });
    order.length = 0;

    const second = await launchLegacySimulatorLab(deps, { examAttemptId: "ea-1" });

    expect(second).toEqual(first);
    expect(order).toEqual([]);
    expect(await launches.findByExamAttemptId("ea-1")).toEqual(first);
  });

  it("surfaces an actionable error and aborts before the sponsored link when Add Student fails", async () => {
    const sponsored = vi.fn();
    const { labs, order } = provisioner({
      async addStudent() {
        throw new Error("registration rejected");
      },
      createSponsoredLink: sponsored as LabProvisioner["createSponsoredLink"],
    });
    const { deps, launches } = await setup(labs);

    await expect(
      launchLegacySimulatorLab(deps, { examAttemptId: "ea-1" }),
    ).rejects.toBeInstanceOf(LabLaunchError);
    expect(order).toEqual(["createExperience"]);
    expect(sponsored).not.toHaveBeenCalled();
    expect(await launches.findByExamAttemptId("ea-1")).toBeNull();
  });
});
