import { CloudShareRateLimitError } from "./errors";
import type { CloudShareClient, V4RequestSpec } from "./client";

/**
 * A deliberately opt-in development-only fixture for browser QA of the Cohort
 * Session Monitoring rate-limit presentation. It never sends a request to
 * CloudShare and is impossible to activate outside `next dev`.
 */
export const LOCAL_COHORT_RATE_LIMIT_TRAINING_ID = "EXlocalRateLimit429";

const scenarioName = "cohort-participant-429";

export function withLocalCohortRateLimitQaFixture(
  client: CloudShareClient,
  env: NodeJS.ProcessEnv = process.env,
): CloudShareClient {
  if (env.NODE_ENV !== "development" || env.PORTAL_LOCAL_QA_SCENARIO !== scenarioName) {
    return client;
  }

  const shouldFail = (spec: Pick<V4RequestSpec<unknown>, "method" | "path">) =>
    spec.method === "GET" && spec.path === `/trainings/${LOCAL_COHORT_RATE_LIMIT_TRAINING_ID}/students`;

  const rateLimitError = () =>
    new CloudShareRateLimitError(
      "Local QA fixture: CloudShare is temporarily throttling participant monitoring requests.",
      429,
      "abuse_protection",
      {
        integrationSurface: "cloudshare.v4",
        method: "GET",
        path: `/v4/trainings/${LOCAL_COHORT_RATE_LIMIT_TRAINING_ID}/students`,
        responseHeaders: {
          "content-type": "application/json; charset=utf-8",
          "x-local-qa-fixture": "cohort-participant-429",
        },
        responseBody: {
          message: "An error has occured processing your request, please contact support@cloudshare.com",
          code: "0x42901",
        },
      },
    );

  return {
    ...client,
    async requestV4<T>(spec: V4RequestSpec<T>): Promise<T> {
      if (shouldFail(spec)) {
        throw rateLimitError();
      }
      return client.requestV4(spec);
    },
    ...(client.requestV4Detailed
      ? {
          async requestV4Detailed<T>(spec: V4RequestSpec<T>) {
            if (shouldFail(spec)) {
              throw rateLimitError();
            }
            return client.requestV4Detailed!(spec);
          },
        }
      : {}),
  };
}
