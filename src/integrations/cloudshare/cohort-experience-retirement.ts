import { z } from "zod";
import type { CloudShareClient, CloudShareDetailedResult } from "./client";
import { CloudShareResponseError } from "./errors";

const updatedTrainingSchema = z
  .object({
    id: z.string().min(1),
    end: z.string().min(1).optional(),
    End: z.string().min(1).optional(),
  })
  .passthrough();

const trainingDetailSchema = z
  .object({
    id: z.string().min(1),
    end: z.string().min(1).optional(),
    End: z.string().min(1).optional(),
  })
  .passthrough();

export interface RetireCloudShareTrainingResult {
  readonly trainingId: string;
  readonly end: string | null;
  readonly integrationSurface: string;
  readonly request: {
    readonly method: string;
    readonly path: string;
    readonly query?: Record<string, string>;
    readonly headers?: Record<string, string>;
    readonly body?: unknown;
  };
  readonly response: {
    readonly status: number;
    readonly headers?: Record<string, string | string[]>;
    readonly body: unknown;
  };
}

export interface CloudShareTrainingRetirementWriter {
  retireTrainingToEnd(input: {
    readonly trainingId: string;
    readonly end: Date;
  }): Promise<RetireCloudShareTrainingResult>;
}

export function createCloudShareTrainingRetirementWriter(
  client: CloudShareClient,
): CloudShareTrainingRetirementWriter {
  if (typeof client.requestV4Detailed !== "function") {
    throw new Error("CloudShare training retirement requires requestV4Detailed support.");
  }

  return {
    async retireTrainingToEnd(input): Promise<RetireCloudShareTrainingResult> {
      const expectedEnd = input.end.toISOString();
      const result = (await client.requestV4Detailed!({
        method: "PUT",
        path: `/trainings/${input.trainingId}`,
        body: {
          End: expectedEnd,
        },
        schema: updatedTrainingSchema,
      })) as CloudShareDetailedResult<z.infer<typeof updatedTrainingSchema>>;
      const updateEnd = result.data.end ?? result.data.End ?? null;

      if (updateEnd !== expectedEnd) {
        const readback = (await client.requestV4Detailed!({
          method: "GET",
          path: `/trainings/${input.trainingId}`,
          schema: trainingDetailSchema,
        })) as CloudShareDetailedResult<z.infer<typeof trainingDetailSchema>>;
        const confirmedEnd = readback.data.end ?? readback.data.End ?? null;

        if (confirmedEnd !== expectedEnd) {
          throw new CloudShareResponseError(
            "CloudShare did not confirm the Cohort Exam Session retirement end time.",
            {
              method: result.request.method,
              path: result.request.path,
              requestBody: result.request.body,
              integrationSurface: result.integrationSurface,
              responseBody: {
                update: result.response.body,
                readback: readback.response.body,
              },
              cause: "retire_training_end_unconfirmed",
              expectedEnd,
              confirmedEnd,
            },
          );
        }

        return {
          trainingId: result.data.id,
          end: confirmedEnd,
          integrationSurface: result.integrationSurface,
          request: result.request,
          response: result.response,
        };
      }

      return {
        trainingId: result.data.id,
        end: updateEnd,
        integrationSurface: result.integrationSurface,
        request: result.request,
        response: result.response,
      };
    },
  };
}
