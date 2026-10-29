import { z } from "zod";
import type { CloudShareClient } from "./client";
const vmSchema = z.object({ id: z.string().startsWith("MC"), name: z.string(), os: z.string().nullable(), progress: z.number().int().min(0).max(100), externalAddress: z.string().nullable(), status: z.string().optional() });
const pageSchema = z.object({ count: z.number().int().nonnegative(), items: z.array(vmSchema) });
export type TrialRdpVm = z.infer<typeof vmSchema>;
/** Status is display text, not an enum; reject known stopped/transitional states. */
export function trialRdpVmAvailability(vm: TrialRdpVm): "ready" | "preparing" | "unavailable" {
 if (vm.os !== "Windows") return "unavailable";
 if (vm.progress < 100) return "preparing";
 if (!vm.externalAddress?.trim() || /suspend|archiv|delet|revert|reboot|prepar|loading|failed|snapshot|network|stopp|power off/i.test(vm.status ?? "")) return "unavailable";
 return "ready";
}
export function createCloudShareTrialRdp(client: CloudShareClient) {
 return {
  async download(environmentId: string, vmId: string): Promise<string> {
   const vm = await client.requestV4({ method: "GET", path: `/environments/${encodeURIComponent(environmentId)}/vms/${encodeURIComponent(vmId)}`, schema: vmSchema });
   if (vm.id !== vmId || trialRdpVmAvailability(vm) !== "ready") throw new Error("VM is unavailable for remote desktop.");
   const file = await client.requestV3({ method: "GET", path: "/vms/actions/getremoteaccessfile", query: { vmId, desktopWidth: "1920", desktopHeight: "1080" }, schema: z.object({ rdpFileContent: z.string().min(1), clearTextPassword: z.string().optional() }) });
   return file.rdpFileContent;
  },
  async list(environmentId: string): Promise<TrialRdpVm[]> {
   const items: TrialRdpVm[] = [];
   let total: number | undefined;
   do {
    const page = await client.requestV4({ method: "GET", path: `/environments/${encodeURIComponent(environmentId)}/vms`, query: { Count: "true", Offset: String(items.length), Limit: "100" }, schema: pageSchema });
    if ((total !== undefined && total !== page.count) || page.count > 1000 || (page.items.length === 0 && items.length < page.count) || items.length + page.items.length > page.count || new Set([...items, ...page.items].map(vm => vm.id)).size !== items.length + page.items.length) throw new Error("Incomplete VM observation.");
    total = page.count;
    items.push(...page.items);
   } while (items.length < total);
   return items;
  },
 };
}

