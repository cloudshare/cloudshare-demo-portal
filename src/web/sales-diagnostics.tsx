"use client";

import React, { useCallback, useMemo } from "react";
import { useRouter } from "next/navigation";
import { createAdminAuthenticatedRequest } from "./admin-authenticated-request";
import { AdminSupportFeature } from "./admin-support";
import { compactButtonStyle } from "./button-styles";
import { pageShellStyle } from "./page-shell";
import { PortalPageHeader } from "./portal-page-header";

const salesDiagnosticsPageStyle = { ...pageShellStyle, maxWidth: "96rem", padding: "2rem clamp(1.25rem, 3vw, 3rem) 3rem" };

export function SalesDiagnostics({ email }: { readonly email: string }) {
  const router = useRouter();
  const browserFetch = useCallback<typeof fetch>((input, init) => window.fetch(input, init), []);
  const fetchAdmin = useMemo(() => createAdminAuthenticatedRequest({ fetchImpl: browserFetch, onSessionExpired: () => { router.replace("/login"); router.refresh(); } }), [browserFetch, router]);

  return <main style={salesDiagnosticsPageStyle}>
    <PortalPageHeader eyebrow="Certalis Sales Portal" title="Sales Diagnostics" description="Append-only support evidence for local Sales records in the Certalis Customer workspace." email={email} actions={<button type="button" onClick={() => router.push("/sales")} style={compactButtonStyle}>Back to Sales Workspace</button>} />
    <AdminSupportFeature active view="diagnostics" diagnosticFilters={{ source: "sales-records" }} lockedDiagnosticFilters={{ source: "sales-records" }} diagnosticsEndpoint="/api/sales/diagnostics" fetchAdmin={fetchAdmin} onNavigate={() => undefined} />
  </main>;
}
