"use client";

import React, { useCallback, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { createAdminAuthenticatedRequest } from "./admin-authenticated-request";
import { AdminSupportFeature } from "./admin-support";
import { compactButtonStyle } from "./button-styles";
import { pageShellStyle } from "./page-shell";
import { PortalPageHeader } from "./portal-page-header";
import { createPortalSessionExpiryRedirect } from "./portal-session-redirect";
import { startPortalSessionWatchdog } from "./session-expiry";

const salesDiagnosticsPageStyle = { ...pageShellStyle, maxWidth: "96rem", padding: "2rem clamp(1.25rem, 3vw, 3rem) 3rem" };

export function SalesDiagnostics({ email }: { readonly email: string }) {
  const router = useRouter();
  const [sessionExpired, setSessionExpired] = useState(false);
  const browserFetch = useCallback<typeof fetch>((input, init) => window.fetch(input, init), []);
  const handleSessionExpired = useMemo(() => createPortalSessionExpiryRedirect({
    currentPath: () => `${window.location.pathname}${window.location.search}`,
    fallbackLoginPath: "/login",
    replace: (path) => {
      setSessionExpired(true);
      router.replace(path);
    },
  }), [router]);
  const fetchAdmin = useMemo(() => createAdminAuthenticatedRequest({ fetchImpl: browserFetch, onSessionExpired: handleSessionExpired }), [browserFetch, handleSessionExpired]);
  React.useEffect(() => { if (sessionExpired) return; const watchdog = startPortalSessionWatchdog({ fetchImpl: browserFetch, onExpired: handleSessionExpired }); void watchdog.checkNow(); return () => watchdog.stop(); }, [browserFetch, handleSessionExpired, sessionExpired]);

  if (sessionExpired) return null;

  return <main style={salesDiagnosticsPageStyle}>
    <PortalPageHeader eyebrow="Certalis Sales Portal" title="Sales Diagnostics" description="Append-only support evidence for local Sales records in the Certalis Customer workspace." email={email} actions={<button type="button" onClick={() => router.push("/sales")} style={compactButtonStyle}>Back to Sales Workspace</button>} />
    <AdminSupportFeature active view="diagnostics" diagnosticFilters={{ source: "sales-records" }} lockedDiagnosticFilters={{ source: "sales-records" }} diagnosticsEndpoint="/api/sales/diagnostics" fetchAdmin={fetchAdmin} onNavigate={() => undefined} />
  </main>;
}
