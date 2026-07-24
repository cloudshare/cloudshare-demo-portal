"use client";

import React from "react";
import { useRouter } from "next/navigation";
import { SALES_TABS, buildSalesWorkspaceHref, getSalesTabLabel, type SalesTab } from "./sales-shell-route";
import styles from "./sales-workspace.module.css";

export function SalesWorkspaceChrome({ email, activeTab, children }: { readonly email: string; readonly activeTab: SalesTab; readonly children: React.ReactNode }) {
  const router = useRouter();
  const logout = async () => { await fetch("/api/auth/logout", { method: "POST" }); router.push("/login"); router.refresh(); };
  return <div className={styles.appShell}><aside className={styles.leftNav} aria-label="Sales workspace navigation"><div className={styles.brand}><span className={styles.brandMark} aria-hidden="true">C</span><div className={styles.brandText}><strong>Certalis</strong><small>Sales workspace</small></div></div><nav className={styles.nav} aria-label="Sales workspace sections">{SALES_TABS.map((tab) => <a key={tab} className={styles.navButton} data-active={activeTab === tab ? "true" : undefined} aria-current={activeTab === tab ? "page" : undefined} href={buildSalesWorkspaceHref(tab === "sessions" ? { tab, queueView: "active" } : { tab })}><span className={styles.navIcon} aria-hidden="true">{tab === "sessions" ? "▣" : tab === "records" ? "◇" : tab === "items" ? "□" : "?"}</span>{getSalesTabLabel(tab)}</a>)}</nav><div className={styles.navSpacer} /><div className={styles.account}><span className={styles.accountMark} aria-hidden="true">SA</span><div className={styles.accountText}><strong>Sales admin</strong><small>{email}</small></div></div><button type="button" className={styles.logoutButton} onClick={() => void logout()}>Log out</button></aside><main className={styles.main}><header className={styles.topbar}><div><p>Certalis</p><span>Sales workspace</span></div></header><div className={styles.content}>{children}</div></main></div>;
}
