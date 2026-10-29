import { CloudShareResponseError } from "./errors";
import { z } from "zod";
import type { CloudShareClient, CloudShareDetailedResult, V4RequestSpec } from "./client";
const vmSchema = z.object({ id: z.string().startsWith("MC"), name: z.string(), os: z.string().nullable(), progress: z.number().int().min(0).max(100), status: z.string().optional(), fqdn: z.unknown().optional() }).transform(({ fqdn, ...vm }) => ({
 ...vm,
 // Human-confirmed tenant behavior: FQDN reflects configured public remote access.
 // Preserve only the derived signal; never project the hostname outside this adapter.
 publicRdpConfigured: fqdn === null || typeof fqdn === "string" ? typeof fqdn === "string" && fqdn.trim().length > 0 : null,
}));
const pageSchema = z.object({ count: z.number().int().nonnegative(), items: z.array(vmSchema) });
export type TrialRdpVm = z.infer<typeof vmSchema>;
/** Running is the documented positive display label, not a stable provider enum.
 * Unknown/new labels fail closed until their readiness semantics are verified. */
export function trialRdpVmAvailability(vm: TrialRdpVm): "ready" | "preparing" | "unavailable" {
 if (vm.os !== "Windows" || vm.publicRdpConfigured !== true) return "unavailable";
 if (vm.progress < 100) return "preparing";
 if (vm.status?.trim().toLowerCase() !== "running") return "unavailable";
 return "ready";
}
export function createCloudShareTrialRdp(client: CloudShareClient) {
 return {
  async download(environmentId: string, vmId: string): Promise<string> {
   const detail = await readVm(client, { method: "GET", path: `/environments/${encodeURIComponent(environmentId)}/vms/${encodeURIComponent(vmId)}`, schema: vmSchema });
   const vm = detail.data;
   if (vm.id !== vmId || trialRdpVmAvailability(vm) !== "ready") throw invalidVm(detail, "vm_not_ready_or_mismatched", "VM is unavailable for remote desktop.");
   const file = await client.requestV3({ method: "GET", path: "/vms/actions/getremoteaccessfile", query: { vmId, desktopWidth: "1920", desktopHeight: "1080" }, schema: z.object({ rdpFileContent: z.string().min(1), clearTextPassword: z.string().optional() }) });
   return file.rdpFileContent;
  },
  async list(environmentId: string): Promise<TrialRdpVm[]> {
   const items: TrialRdpVm[] = [];
   let total: number | undefined;
   do {
    const result = await readVm(client, { method: "GET", path: `/environments/${encodeURIComponent(environmentId)}/vms`, query: { Count: "true", Offset: String(items.length), Limit: "100" }, schema: pageSchema });
    const page = result.data;
    if ((total !== undefined && total !== page.count) || page.count > 1000 || (page.items.length === 0 && items.length < page.count) || items.length + page.items.length > page.count || new Set([...items, ...page.items].map(vm => vm.id)).size !== items.length + page.items.length) throw invalidVm(result, "inconsistent_vm_page", "Incomplete VM observation.");
    total = page.count;
    items.push(...page.items);
   } while (items.length < total);
   return items;
  },
 };
}



type VmRead<T> = Pick<CloudShareDetailedResult<T>, "data" | "request" | "response">;
async function readVm<T>(client: CloudShareClient, spec: V4RequestSpec<T>): Promise<VmRead<T>> {
 if (client.requestV4Detailed) return client.requestV4Detailed(spec);
 const data = await client.requestV4(spec);
 return { data, request: { method: spec.method, path: `/v4${spec.path}`, query: spec.query }, response: { status: 200, body: data } };
}
function invalidVm(result: VmRead<unknown>, failureMode: string, message: string) {
 return new CloudShareResponseError(message, { failureMode, integrationSurface: "cloudshare.v4.environments.vms", method: result.request.method, path: result.request.path, requestQuery: result.request.query, requestHeaders: result.request.headers, responseStatus: result.response.status, responseHeaders: result.response.headers, responseBody: result.response.body });
}
