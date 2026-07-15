import { z } from "zod";
import type { CloudShareClient, CloudShareDetailedResult } from "./client";

const timezonesSchema = z.array(z.object({ id: z.string().min(1), name: z.string().min(1) })).or(z.object({ Rows: z.array(z.object({ id: z.string().min(1), name: z.string().min(1) })) }));
export interface CloudShareTimezone { readonly id: string; readonly name: string; }
export interface CloudShareTimezoneSource { list(): Promise<{ readonly timezones: readonly CloudShareTimezone[]; readonly request: unknown; readonly response: unknown }>; }

/** The sole v3 timezone wire seam. Its caller can cache the returned projection;
 * no UI is allowed to invent a time-zone list. */
export function createCloudShareTimezoneSource(client: CloudShareClient): CloudShareTimezoneSource {
  return {
    async list() {
      const spec = { method: "GET" as const, path: "/timezones", schema: timezonesSchema };
      const result = client.requestV3Detailed ? await client.requestV3Detailed(spec) : await client.requestV3(spec).then((data) => ({ data, request: { method: "GET" as const, path: "/timezones" }, response: { status: 200, body: data } } as CloudShareDetailedResult<z.infer<typeof timezonesSchema>>));
      const values = Array.isArray(result.data) ? result.data : result.data.Rows;
      return { timezones: values.map((value) => ({ id: value.id, name: value.name })), request: result.request, response: result.response };
    },
  };
}
