import { describe, it, expect, vi } from "vitest";
import { launchLab, type LabProvisioner } from "./lab-launch";
import { LabLaunchError, NotEntitledError } from "./errors";
import { createInMemoryExamAttemptRepository } from "@/persistence/exam-attempt-repository";
import { createInMemoryLabLaunchRepository } from "@/persistence/lab-launch-repository";
import type { ExamAttempt } from "./exam-attempt";

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

describe("launchLab", () => {
  it("provisions in strict order: experience -> add student -> sponsored link", async () => {
    const { labs, order } = provisioner();
    const { deps } = await setup(labs);

    await launchLab(deps, { examAttemptId: "ea-1" });

    expect(order).toEqual(["createExperience", "addStudent", "createSponsoredLink"]);
  });

  it("creates the experience as Registered Students Only with a persisted environmentExternalId", async () => {
    const { labs, createArgs } = provisioner();
    const { deps, launches } = await setup(labs);

    const launch = await launchLab(deps, { examAttemptId: "ea-1" });

    expect(createArgs()).toMatchObject({
      registeredStudentsOnly: true,
      environmentExternalId: "env-ext-1",
    });
    expect(launch.environmentExternalId).toBe("env-ext-1");
    expect(launch.loginUrl).toBe("https://classic.cloudshare.com/login?t=demo");
    expect(await launches.findByExamAttemptId("ea-1")).toEqual(launch);
  });

  it("recomputes entitlement server-side: an unknown attempt is denied", async () => {
    const { labs, order } = provisioner();
    const { deps } = await setup(labs, null); // nothing persisted

    await expect(launchLab(deps, { examAttemptId: "ghost" })).rejects.toBeInstanceOf(
      NotEntitledError,
    );
    expect(order).toEqual([]); // no CloudShare calls for an unentitled attempt
  });

  it("returns the existing launch without re-provisioning when one already exists for the attempt", async () => {
    const { labs, order } = provisioner();
    const { deps, launches } = await setup(labs);

    const first = await launchLab(deps, { examAttemptId: "ea-1" });
    order.length = 0; // reset call log

    const second = await launchLab(deps, { examAttemptId: "ea-1" });

    expect(second).toEqual(first);
    expect(order).toEqual([]); // no new CloudShare calls
    expect(await launches.findByExamAttemptId("ea-1")).toEqual(first); // not duplicated
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

    await expect(launchLab(deps, { examAttemptId: "ea-1" })).rejects.toBeInstanceOf(
      LabLaunchError,
    );
    // Got past createExperience; addStudent threw (hence LabLaunchError) and the
    // flow aborted before the sponsored link.
    expect(order).toEqual(["createExperience"]);
    expect(sponsored).not.toHaveBeenCalled();
    expect(await launches.findByExamAttemptId("ea-1")).toBeNull(); // nothing persisted
  });
});
