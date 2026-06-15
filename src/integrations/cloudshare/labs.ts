import { z } from "zod";
import type { CloudShareClient } from "./client";
import type {
  AddParticipantInput,
  AddStudentInput,
  CreateExperienceInput,
  CreateExperienceResult,
  CreateTrainingInput,
  CreateTrainingResult,
  CreateSponsoredLinkInput,
  CreateSponsoredLinkResult,
  LabProvisioner,
} from "@/domain/lab-launch";

/**
 * CloudShare implementation of the {@link LabProvisioner} port, built on the v4
 * adapter. It performs the three Accelerate calls the lab-launch flow needs, with
 * Zod-validated responses; failures surface as the adapter's typed CloudShareErrors.
 *
 * NOTE (assumptions to verify against a live tenant, isolated behind this module):
 * the exact v4 paths/bodies below — `/trainings`, the participant-add shape, and
 * the sponsored-link body — are modelled on the documented Accelerate flow and
 * local discovery notes. Only this file changes if they differ.
 */

const experienceSchema = z.object({ id: z.string().min(1) });
const addStudentSchema = z.object({}).passthrough();
const sponsoredLinkSchema = z.object({ loginUrl: z.string().url() });

export function createCloudShareLabProvisioner(
  client: CloudShareClient,
): LabProvisioner {
  return {
    async createTraining(input: CreateTrainingInput): Promise<CreateTrainingResult> {
      const training = await client.requestV4({
        method: "POST",
        path: "/trainings",
        body: {
          title: input.title,
          start: input.scheduledFor.toISOString(),
          type: "instructorLed",
          projectId: input.projectId,
          blueprintId: input.blueprintId,
          policyId: input.policyId,
          regionId: input.regionId,
          instructorId: input.instructorId,
        },
        schema: experienceSchema,
      });
      return { trainingId: training.id };
    },

    async addParticipant(input: AddParticipantInput): Promise<void> {
      await client.requestV4({
        method: "POST",
        path: `/trainings/${input.trainingId}/students`,
        body: {
          email: input.email,
          firstName: input.firstName,
          lastName: input.lastName,
        },
        schema: addStudentSchema,
      });
    },

    async createExperience(input: CreateExperienceInput): Promise<CreateExperienceResult> {
      const experience = await client.requestV4({
        method: "POST",
        path: "/experiences",
        body: {
          title: input.title,
          // The security-critical setting: the experience admits only students
          // explicitly registered via Add Student.
          visibility: "RegisteredStudentsOnly",
          // Correlation id we set at creation and persist for later matching.
          externalId: input.environmentExternalId,
        },
        schema: experienceSchema,
      });
      return { experienceId: experience.id };
    },

    async addStudent(input: AddStudentInput): Promise<void> {
      // A non-2xx response throws CloudShareRequestError inside the adapter, so a
      // failed/skipped registration can never resolve successfully.
      await client.requestV4({
        method: "POST",
        path: `/experiences/${input.experienceId}/students`,
        body: { candidateId: input.candidateId },
        schema: addStudentSchema,
      });
    },

    async createSponsoredLink(
      input: CreateSponsoredLinkInput,
    ): Promise<CreateSponsoredLinkResult> {
      const link = await client.requestV4({
        method: "POST",
        path:
          input.trainingId !== undefined
            ? `/trainings/${input.trainingId}/sponsored-link`
            : `/experiences/${input.experienceId}/sponsoredLinks`,
        body:
          input.trainingId !== undefined
            ? {
                email: input.email,
                firstName: input.firstName,
                lastName: input.lastName,
              }
            : undefined,
        schema: sponsoredLinkSchema,
      });
      return { loginUrl: link.loginUrl };
    },
  };
}
