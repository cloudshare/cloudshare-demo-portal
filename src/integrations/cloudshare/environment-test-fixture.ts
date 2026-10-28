import { vi } from "vitest";
import { z } from "zod";
import type { CloudShareClient, V4RequestSpec } from "./client";

/** Handler state/command script at the integration boundary. Recording HTTP tests
 * separately prove authentication and physical wire requests. */
export type EnvironmentFixtureClient = CloudShareClient & {
  readEnvironment: CloudShareClient["requestV4"];
  writeEnvironment: CloudShareClient["requestV4"];
};
type FixtureInput = Partial<EnvironmentFixtureClient> & { writeEnvironmentDetailed?: CloudShareClient["requestV4Detailed"] };
export function environmentFixtureClient(input: FixtureInput): EnvironmentFixtureClient {
  const readEnvironment = input.readEnvironment ?? (async () => { throw new Error("Unexpected Environment fixture read"); });
  const writeEnvironment: CloudShareClient["requestV4"] = input.writeEnvironment ?? (async <T>(spec: V4RequestSpec<T>): Promise<T> => spec.schema.parse(undefined));
  const requestV4 = vi.fn(async <T>(spec: V4RequestSpec<T>): Promise<T> => {
    if (!spec.path.startsWith("/environments/")) return input.requestV4!(spec);
    if (spec.method === "POST") return writeEnvironment(spec);
    const raw = await readEnvironment({ ...spec, schema: z.unknown() }) as { status?: string; envStatus?: string };
    const status = (raw.status ?? raw.envStatus ?? "unknown").toLowerCase();
    return spec.schema.parse({ id: decodeURIComponent(spec.path.slice("/environments/".length)), projectId: "fixture-project", ownerEmail: "fixture@example.test", status: status === "running" ? "ready" : status, startTime: "Mon, 15 Jun 2026 09:00:00 GMT", expirationTime: "Tue, 16 Jun 2026 09:00:00 GMT" });
  }) as CloudShareClient["requestV4"];
  return { ...input, readEnvironment, writeEnvironment, requestV4,
    ...(input.writeEnvironmentDetailed ? { requestV4Detailed: async <T>(spec: V4RequestSpec<T>) => {
      if (spec.method === "POST" && spec.path.startsWith("/environments/")) return input.writeEnvironmentDetailed!(spec);
      return { data: await requestV4(spec), host: "fixture", integrationSurface: "cloudshare.v4", request: { method: spec.method, path: `/v4${spec.path}` }, response: { status: 200, body: {} } };
    } } : {}),
  } as EnvironmentFixtureClient;
}
