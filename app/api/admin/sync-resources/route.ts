import { NextResponse } from "next/server";
import { getServices } from "@/composition";
import { handleSyncResources } from "@/api/admin";

/** POST /api/admin/sync-resources — fetches CloudShare resource lists and caches them in-memory. */
export async function POST() {
  const { resourceLister, resources, logger } = getServices();

  const resp = await handleSyncResources(
    { lister: resourceLister, resources, logger },
    {},
  );
  return NextResponse.json(resp.body, { status: resp.status });
}
