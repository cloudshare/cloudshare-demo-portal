import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import type { CloudShareClient } from "./client";
import {
  LOCAL_COHORT_RATE_LIMIT_TRAINING_ID,
  withLocalCohortRateLimitQaFixture,
} from "./local-rate-limit-qa-fixture";

describe("local cohort rate-limit QA fixture", () => {
  it("is disabled unless explicitly enabled in a development runtime", async () => {
    const requestV4 = vi.fn().mockResolvedValue([]);
    const client = { requestV4, requestV3: vi.fn(), requestV3Text: vi.fn() } as unknown as CloudShareClient;
    const wrapped = withLocalCohortRateLimitQaFixture(client, {
      NODE_ENV: "production",
      PORTAL_LOCAL_QA_SCENARIO: "cohort-participant-429",
    });

    await expect(
      wrapped.requestV4({ method: "GET", path: `/trainings/${LOCAL_COHORT_RATE_LIMIT_TRAINING_ID}/students`, schema: z.array(z.unknown()) }),
    ).resolves.toEqual([]);
    expect(requestV4).toHaveBeenCalledOnce();
  });

  it("throws redacted observed 429 evidence only for the local QA cohort participant read", async () => {
    const requestV4 = vi.fn().mockResolvedValue([]);
    const client = { requestV4, requestV3: vi.fn(), requestV3Text: vi.fn() } as unknown as CloudShareClient;
    const wrapped = withLocalCohortRateLimitQaFixture(client, {
      NODE_ENV: "development",
      PORTAL_LOCAL_QA_SCENARIO: "cohort-participant-429",
    });

    await expect(
      wrapped.requestV4({ method: "GET", path: `/trainings/${LOCAL_COHORT_RATE_LIMIT_TRAINING_ID}/students`, schema: z.array(z.unknown()) }),
    ).rejects.toMatchObject({
      name: "CloudShareRateLimitError",
      status: 429,
      context: {
        method: "GET",
        path: `/v4/trainings/${LOCAL_COHORT_RATE_LIMIT_TRAINING_ID}/students`,
        responseBody: { code: "0x42901" },
      },
    });
    expect(requestV4).not.toHaveBeenCalled();
  });
});
