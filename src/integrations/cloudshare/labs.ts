import { z } from "zod";
import type { CloudShareClient } from "./client";
import type {
  AddStudentInput,
  CreateExperienceInput,
  CreateExperienceResult,
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
 * the exact v4 paths/bodies below — `/experiences`, the `RegisteredStudentsOnly`
 * visibility value, the `/students` and `/sponsoredLinks` sub-resources — are
 * modelled on the documented Accelerate flow. Only this file changes if they differ.
 */

const experienceSchema = z.object({ id: z.string().min(1) });
const addStudentSchema = z.object({}).passthrough();
const sponsoredLinkSchema = z.object({ loginUrl: z.string().url() });

export function createCloudShareLabProvisioner(
  client: CloudShareClient,
): LabProvisioner {
  return {
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
        path: `/experiences/${input.experienceId}/sponsoredLinks`,
        schema: sponsoredLinkSchema,
      });
      return { loginUrl: link.loginUrl };
    },
  };
}
