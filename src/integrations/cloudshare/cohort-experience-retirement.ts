import { z } from "zod";
import type { CloudShareClient, CloudShareDetailedResult } from "./client";

const updatedTrainingSchema = z
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
      const result = (await client.requestV4Detailed!({
        method: "PUT",
        path: `/trainings/${input.trainingId}`,
        body: {
          End: input.end.toISOString(),
        },
        schema: updatedTrainingSchema,
      })) as CloudShareDetailedResult<z.infer<typeof updatedTrainingSchema>>;

      return {
        trainingId: result.data.id,
        end: result.data.end ?? result.data.End ?? null,
        integrationSurface: result.integrationSurface,
        request: result.request,
        response: result.response,
      };
    },
  };
}
