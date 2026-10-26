import { vi } from "vitest";
import { z } from "zod";
import type { CloudShareClient, V4RequestSpec } from "./client";

/** Handler fixture: a state script plus the existing Experience/command fixture.
 * Real wire contracts are exercised separately through recording HTTP.
 */
export type EnvironmentFixtureClient = CloudShareClient & { readEnvironment: CloudShareClient["requestV4"] };
export function environmentFixtureClient(input: Partial<CloudShareClient> & { readEnvironment?: CloudShareClient["requestV4"] }): EnvironmentFixtureClient {
  const readEnvironment = input.readEnvironment ?? (async () => { throw new Error("Unexpected Environment fixture read"); });
  return { ...input, readEnvironment,
    requestV4: vi.fn(async <T>(spec: V4RequestSpec<T>): Promise<T> => {
      if (!spec.path.startsWith("/environments/")) return input.requestV4!(spec);
      const raw = await readEnvironment({ ...spec, schema: z.unknown() }) as { status?: string; envStatus?: string };
      const status = (raw.status ?? raw.envStatus ?? "unknown").toLowerCase();
      return spec.schema.parse({ id: decodeURIComponent(spec.path.slice("/environments/".length)), projectId: "fixture-project", ownerEmail: "fixture@example.test", status: status === "running" ? "ready" : status, startTime: "Mon, 15 Jun 2026 09:00:00 GMT", expirationTime: "Tue, 16 Jun 2026 09:00:00 GMT" });
    }) as CloudShareClient["requestV4"],
  } as EnvironmentFixtureClient;
}
