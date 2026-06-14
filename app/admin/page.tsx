import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { getServices } from "@/composition";
import { getPortalAdminSession } from "@/auth/portal-session";
import { PORTAL_SESSION_COOKIE } from "@/api/portal-auth";
import { AdminConsole } from "@/web/admin-console";

export default async function AdminPage() {
  const services = getServices();
  const sessionId = (await cookies()).get(PORTAL_SESSION_COOKIE)?.value;
  const session = await getPortalAdminSession(services, sessionId);

  if (!session) {
    redirect("/login");
  }

  return <AdminConsole email={session.email} />;
}
