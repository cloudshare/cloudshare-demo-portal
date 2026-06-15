import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { getServices } from "@/composition";
import { getPortalHomePath, getPortalSession } from "@/auth/portal-session";
import { PORTAL_SESSION_COOKIE } from "@/api/portal-auth";

export default async function Home() {
  const services = getServices();
  const sessionId = (await cookies()).get(PORTAL_SESSION_COOKIE)?.value;
  const session = await getPortalSession(services, sessionId);
  redirect(getPortalHomePath(session));
}
