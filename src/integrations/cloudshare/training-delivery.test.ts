import { describe, expect, it, vi } from "vitest";
import { createCloudShareTrainingDelivery } from "./training-delivery";

describe("Training delivery", () => {
  it("concentrates Training creation and participant reads behind one Customer-scoped interface", async () => {
    const requestV3 = vi.fn(async (request: { readonly path: string }) => {
      if (request.path === "/teams") {
        return [{ id: "team-1", name: "Delivery" }];
      }
      throw new Error(`Unexpected v3 request: ${request.path}`);
    });
    const requestV4Detailed = vi.fn(async (request: { readonly path: string }) => {
      if (request.path === "/trainings") {
        return {
          data: { id: "EXtraining-1" },
          integrationSurface: "cloudshare.v4.training.create",
          request: { method: "POST", path: request.path },
          response: { status: 201, body: { id: "EXtraining-1" } },
        };
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

    const training = await delivery.createTraining({
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
    });
    const participants = await delivery.readParticipants("EXtraining-1");

    expect(training.trainingId).toBe("EXtraining-1");
    expect(participants.participants).toEqual([
      expect.objectContaining({ id: "participant-1", email: "candidate@example.test" }),
    ]);
    expect(requestV3).toHaveBeenCalledTimes(1);
    expect(requestV4Detailed).toHaveBeenCalledWith(
      expect.objectContaining({ path: "/trainings" }),
    );
  });
});
