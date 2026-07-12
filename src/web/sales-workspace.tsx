"use client";

import React from "react";
import { useCallback, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { CloudShareConnectionFeature } from "./admin-cloudshare-connection";
import { createAdminAuthenticatedRequest } from "./admin-authenticated-request";
import { accountLogoutButtonStyle } from "./button-styles";
import { mutedPanelStyle } from "./card-styles";
import { pageShellStyle } from "./page-shell";
import { PortalPageHeader } from "./portal-page-header";

export function SalesWorkspace({ email }: { readonly email: string }) {
  const router = useRouter();
  const [showConnection, setShowConnection] = useState(false);
  const browserFetch = useCallback<typeof fetch>((input, init) => window.fetch(input, init), []);
  const fetchAdmin = useMemo(() => createAdminAuthenticatedRequest({
    fetchImpl: browserFetch,
    onSessionExpired: () => { router.replace("/login"); router.refresh(); },
  }), [browserFetch, router]);
  const logout = useCallback(async () => {
    await fetch("/api/auth/logout", { method: "POST" });
    router.push("/login"); router.refresh();
  }, [router]);

  return <main style={pageShellStyle}>
    <PortalPageHeader eyebrow="Certalis Sales Portal" title="Sales Workspace" description="Prepare future CloudShare sales delivery without accessing certification data." email={email} actions={<button onClick={() => void logout()} style={accountLogoutButtonStyle}>Log out</button>} />
    <section style={{ ...mutedPanelStyle, display: "grid", gap: "0.75rem" }}>
      <h2 style={{ margin: 0 }}>No Sales Experiences yet</h2>
      <p style={{ margin: 0 }}>Sales Opportunities and Sales Experiences are not part of this workspace slice.</p>
      <button type="button" onClick={() => setShowConnection((value) => !value)} style={{ justifySelf: "start", padding: "0.55rem 0.9rem" }}>{showConnection ? "Hide CloudShare Connection" : "Connect CloudShare"}</button>
    </section>
    {showConnection ? <section style={{ display: "grid", gap: "1rem", marginTop: "1rem" }} aria-label="Sales CloudShare Connection"><h2 style={{ margin: 0 }}>CloudShare Connection</h2><CloudShareConnectionFeature active fetchAdmin={fetchAdmin} getNavigationHref={() => "/sales"} onNavigate={() => undefined} /></section> : null}
  </main>;
}
