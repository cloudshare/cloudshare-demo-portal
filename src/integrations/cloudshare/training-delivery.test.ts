import { describe, expect, it, vi } from "vitest";
import { TrainingDeliveryOperationError } from "@/domain/lab-launch";
import { createCloudShareTrainingDelivery } from "./training-delivery";

describe("Training delivery", () => {
  it("concentrates Training creation and participant reads behind one Customer-scoped interface", async () => {
    const requestV3 = vi.fn(async (request: { readonly path: string }) => {
      if (request.path === "/teams") {
        return [{ id: "team-1", name: "Delivery" }];
      }
      throw new Error(`Unexpected v3 request: ${request.path}`);
    });
    const requestV4Detailed = vi.fn(async (request: { readonly path: string; readonly method: string }) => {
      if (request.path === "/trainings") {
        return {
          data: { id: "EXtraining-1" },
          integrationSurface: "cloudshare.v4.training.create",
          request: { method: "POST", path: request.path },
          response: { status: 201, body: { id: "EXtraining-1" } },
        };
      }
      if (request.path === "/trainings/EXtraining-1/users/properties" && request.method === "GET") {
        return { data: [], integrationSurface: "cloudshare.v4.training.user_properties", request: { method: "GET", path: request.path }, response: { status: 200, body: [] } };
      }
      if (request.path === "/trainings/EXtraining-1/users/properties" && request.method === "POST") {
        return { data: [{ id: "property-1", name: "certalisExamAttemptId" }, { id: "property-2", name: "certalisCandidateId" }], integrationSurface: "cloudshare.v4.training.user_properties", request: { method: "POST", path: request.path }, response: { status: 201, body: [] } };
      }
      if (request.path === "/trainings/EXtraining-1/students" && request.method === "POST") {
        return { data: [{ id: "participant-1" }], integrationSurface: "cloudshare.v4.training.participant", request: { method: "POST", path: request.path }, response: { status: 201, body: [] } };
      }
      if (request.path === "/trainings/EXtraining-1/sponsored-link") {
        return { data: { loginUrl: "https://cloudshare.example.test/link" }, integrationSurface: "cloudshare.v4.training.sponsored_link", request: { method: "POST", path: request.path }, response: { status: 201, body: {} } };
      }
      if (request.path === "/trainings/EXtraining-1/students") {
        return {
          data: [{ id: "participant-1", email: "candidate@example.test" }],
          integrationSurface: "cloudshare.v4.training.participant_list",
          request: { method: "GET", path: request.path },
          response: { status: 200, body: [{ id: "participant-1", email: "candidate@example.test" }] },
        };
      }
      throw new Error(`Unexpected v4 request: ${request.path}`);
    });
    const delivery = createCloudShareTrainingDelivery({
      requestV3,
      requestV4: vi.fn(async () => []),
      requestV4Detailed,
    } as never);

    const provisioned = await delivery.provisionIndividual({
      training: {
        title: "Candidate Exam",
        scheduledFor: new Date("2026-07-11T09:00:00.000Z"),
        endsAt: new Date("2026-07-11T10:00:00.000Z"),
        projectId: "project-1",
        blueprintId: "blueprint-1",
        policyId: "policy-1",
        regionIds: ["region-1"],
        instructorId: "instructor@example.test",
        passphrase: "certalis-attempt-1",
        timeZoneId: "UTC",
      },
      participant: {
        email: "candidate@example.test",
        firstName: "Candidate",
        lastName: "One",
      },
    });
    const participants = await delivery.readParticipants("EXtraining-1");

    expect(provisioned.training.trainingId).toBe("EXtraining-1");
    expect(participants.participants).toEqual([
      expect.objectContaining({ id: "participant-1", email: "candidate@example.test" }),
    ]);
    expect(requestV3).toHaveBeenCalledTimes(1);
    expect(requestV4Detailed).toHaveBeenCalledWith(
      expect.objectContaining({ path: "/trainings" }),
    );
  });

  it("stops individual provisioning before a sponsored link when participant admission fails", async () => {
    const requestV3 = vi.fn(async () => [{ id: "team-1", name: "Delivery" }]);
    const requestV4Detailed = vi.fn(async (request: { readonly path: string; readonly method: string }) => {
      if (request.path === "/trainings") return { data: { id: "EXtraining-1" }, integrationSurface: "training", request: { method: "POST", path: request.path }, response: { status: 201, body: {} } };
      if (request.path.endsWith("/users/properties")) return { data: request.method === "GET" ? [{ id: "a", name: "certalisExamAttemptId" }, { id: "b", name: "certalisCandidateId" }] : [], integrationSurface: "properties", request: { method: request.method, path: request.path }, response: { status: 200, body: [] } };
      if (request.path.endsWith("/students")) throw new Error("participant rejected");
      throw new Error(`Unexpected v4 request: ${request.path}`);
    });
    const delivery = createCloudShareTrainingDelivery({ requestV3, requestV4: vi.fn(), requestV4Detailed } as never);
    await expect(
      delivery.provisionIndividual({
        training: { title: "Exam", scheduledFor: new Date(), endsAt: new Date(Date.now() + 60_000), projectId: "p", blueprintId: "b", policyId: "policy", regionIds: ["r"], instructorId: "i", passphrase: "x", timeZoneId: "UTC" },
        participant: { email: "candidate@example.test", firstName: "Candidate", lastName: "One" },
      }),
    ).rejects.toMatchObject({ name: TrainingDeliveryOperationError.name, operation: "add_participant" });
    expect(requestV4Detailed).not.toHaveBeenCalledWith(expect.objectContaining({ path: "/trainings/EXtraining-1/sponsored-link" }));
  });

  it("owns Cohort publication and admission ordering through one Training interface", async () => {
    const calls: string[] = [];
    const requestV3 = vi.fn(async (request: { readonly path: string }) => {
      calls.push(`v3:${request.path}`);
      return [{ id: "team-1", name: "Delivery" }];
    });
    const requestV4Detailed = vi.fn(async (request: { readonly path: string; readonly method: string }) => {
      calls.push(`${request.method}:${request.path}`);
      if (request.method === "POST" && request.path === "/trainings") {
        return detailed(request, { id: "EXcohort-1" });
      }
      if (request.method === "GET" && request.path === "/trainings/EXcohort-1") {
        return detailed(request, { id: "EXcohort-1", start: "2026-07-11T09:00:00.000Z" });
      }
      if (request.method === "GET" && request.path.endsWith("/users/properties")) {
        return detailed(request, [
          { id: "attempt", name: "certalisExamAttemptId" },
          { id: "candidate", name: "certalisCandidateId" },
        ]);
      }
      if (request.method === "POST" && request.path.endsWith("/students")) {
        return detailed(request, [{ id: "participant-1" }]);
      }
      if (request.method === "POST" && request.path.endsWith("/sponsored-link")) {
        return detailed(request, { loginUrl: "https://cloudshare.example.test/link" });
      }
      throw new Error(`Unexpected request: ${request.method} ${request.path}`);
    });
    const delivery = createCloudShareTrainingDelivery({
      requestV3,
      requestV4: vi.fn(),
      requestV4Detailed,
    } as never);

    const published = await delivery.publishCohortTraining({
      name: "Cohort Exam",
      startsAt: new Date("2026-07-11T09:00:00.000Z"),
      endsAt: new Date("2026-07-11T10:00:00.000Z"),
      externalId: "cohort-1",
      projectId: "project-1",
      blueprintId: "blueprint-1",
      policyId: "policy-1",
      regionIds: ["region-1"],
      instructorId: "instructor@example.test",
      passphrase: "certalis-cohort-1",
      timeZoneId: "UTC",
    });
    const admission = await delivery.admitCohortParticipant({
      trainingId: published.trainingId,
      experienceId: published.experienceId,
      now: new Date("2026-07-11T09:30:00.000Z"),
      participant: {
        email: "candidate@example.test",
        firstName: "Candidate",
        lastName: "One",
      },
    });

    expect(admission).toMatchObject({ admission: "open", participant: { participantId: "participant-1" } });
    expect(calls).toEqual([
      "v3:/teams",
      "POST:/trainings",
      "GET:/trainings/EXcohort-1/users/properties",
      "GET:/trainings/EXcohort-1",
      "GET:/trainings/EXcohort-1/users/properties",
      "POST:/trainings/EXcohort-1/students",
      "POST:/trainings/EXcohort-1/sponsored-link",
    ]);
  });
});

function detailed(
  request: { readonly path: string; readonly method: string },
  data: unknown,
) {
  return {
    data,
    integrationSurface: "cloudshare.v4.training",
    request: { method: request.method, path: request.path },
    response: { status: 200, body: data },
  };
}
