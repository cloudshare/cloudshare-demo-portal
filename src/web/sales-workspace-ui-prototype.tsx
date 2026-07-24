"use client";

import React, { useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import styles from "./sales-workspace-ui-prototype.module.css";

type Variant = "A" | "B" | "C";

const variants: readonly { key: Variant; name: string }[] = [
  { key: "A", name: "Command deck" },
  { key: "B", name: "Signal canvas" },
  { key: "C", name: "Executive ledger" },
];

const sessions = [
  { name: "Helios solution workshop", account: "Helios CX", opportunity: "Contact centre transformation", time: "2026-07-24 · 14:00–16:00", operation: "Correlated", experience: "In progress", environment: "Ready", attention: false },
  { name: "Northstar discovery lab", account: "Northstar Bank", opportunity: "Cloud migration discovery", time: "2026-07-25 · 09:30–11:00", operation: "Needs attention", experience: "Not started", environment: "Not observed", attention: true },
  { name: "Aperture platform review", account: "Aperture Group", opportunity: "Platform consolidation", time: "2026-07-25 · 13:00–15:30", operation: "Correlated", experience: "Not started", environment: "Scheduled", attention: false },
  { name: "Vela architecture session", account: "Vela Energy", opportunity: "Secure operations", time: "2026-07-28 · 10:00–12:00", operation: "Provisioning", experience: "Not started", environment: "Not assigned", attention: false },
];

export function SalesWorkspaceUiPrototype({ email, variant }: { readonly email: string; readonly variant: Variant }) {
  return <div className={styles.prototype}>
    {variant === "A" ? <CommandDeck email={email} /> : null}
    {variant === "B" ? <SignalCanvas email={email} /> : null}
    {variant === "C" ? <ExecutiveLedger email={email} /> : null}
    <PrototypeSwitcher current={variant} />
  </div>;
}

function CommandDeck({ email }: { readonly email: string }) {
  return <div className={`${styles.shell} ${styles.commandDeck}`}>
    <main className={styles.commandMain}>
      <PrototypeHeader eyebrow="Sales operations" title="Session command" description="A live operational view of every Customer experience." action="Provision session" />
      <div className={styles.metricStrip}>
        <Metric value="12" label="Active" detail="Across 8 accounts" />
        <Metric value="02" label="Needs attention" detail="One requires correlation" tone="alert" />
        <Metric value="94%" label="Environment ready" detail="Last 24 hours" />
      </div>
      <div className={styles.commandBar}>
        <div className={styles.segmented}><button className={styles.activeSegment}>Active <span>12</span></button><button>Attention <span>2</span></button><button>History</button></div>
        <label className={styles.search}><span>⌕</span><input aria-label="Search prototype Sessions" placeholder="Search sessions, accounts, opportunities…" /></label>
        <button className={styles.filterButton}>Filters <span>2</span></button>
      </div>
      <SessionMatrix compact />
    </main>
    <RightRail email={email} mode="dark" />
  </div>;
}

function SignalCanvas({ email }: { readonly email: string }) {
  return <div className={`${styles.shell} ${styles.signalCanvas}`}>
    <main className={styles.canvasMain}>
      <PrototypeHeader eyebrow="Friday, 24 July" title="Good afternoon." description="Two sessions need a decision. The rest of today is on track." action="New session" />
      <div className={styles.canvasGrid}>
        <section className={styles.attentionPanel}>
          <div className={styles.sectionHeading}><div><span className={styles.kicker}>Priority queue</span><h2>Needs your attention</h2></div><button>View all 2 →</button></div>
          <article className={styles.attentionCard}>
            <span className={styles.alertOrb}>!</span>
            <div><strong>Northstar discovery lab</strong><p>Experience created, but correlation was not persisted.</p><small>Northstar Bank · Starts tomorrow at 09:30 Europe/London</small></div>
            <button>Review</button>
          </article>
        </section>
        <section className={styles.timelinePanel}>
          <div className={styles.sectionHeading}><div><span className={styles.kicker}>Schedule</span><h2>Coming up</h2></div><div className={styles.dayToggle}><button className={styles.dayActive}>Today</button><button>Week</button></div></div>
          {sessions.slice(0, 3).map((session, index) => <article className={styles.timelineRow} key={session.name}>
            <div className={styles.timelineTime}><strong>{index === 0 ? "14:00" : index === 1 ? "09:30" : "13:00"}</strong><span>{index === 0 ? "TODAY" : "TOMORROW"}</span></div>
            <div className={styles.timelineMarker}><span /></div>
            <div className={styles.timelineContent}><strong>{session.name}</strong><span>{session.account} · {session.opportunity}</span><div><Pill text={session.experience} /><Pill text={session.environment} neutral /></div></div>
            <button className={styles.moreButton}>•••</button>
          </article>)}
        </section>
      </div>
    </main>
    <RightRail email={email} mode="glass" />
  </div>;
}

function ExecutiveLedger({ email }: { readonly email: string }) {
  return <div className={`${styles.shell} ${styles.executiveLedger}`}>
    <main className={styles.ledgerMain}>
      <PrototypeHeader eyebrow="Certalis / Sales" title="Sessions" description="Customer-scoped experience operations, arranged for rapid scanning." action="+ Provision" />
      <div className={styles.ledgerToolbar}>
        <div><button className={styles.ledgerActive}>Active <sup>12</sup></button><button>Attention <sup>2</sup></button><button>History</button></div>
        <div><button>All accounts⌄</button><button>Newest first⌄</button><button>Search ⌕</button></div>
      </div>
      <SessionMatrix />
    </main>
    <aside className={styles.contextRail}>
      <div className={styles.brandMark}>C</div>
      <nav aria-label="Prototype Sales navigation">
        <NavItem label="Sessions" icon="◫" active />
        <NavItem label="Relationships" icon="◇" />
        <NavItem label="Items" icon="□" />
        <NavItem label="Support" icon="?" />
      </nav>
      <section className={styles.contextCard}><span>Operational health</span><strong>All systems normal</strong><div className={styles.healthLine}><i /><span>CloudShare observed 3m ago</span></div></section>
      <section className={styles.contextCard}><span>Queue snapshot</span><div className={styles.snapshot}><strong>12</strong><span>active</span><strong>2</strong><span>attention</span><strong>47</strong><span>history</span></div></section>
      <UserBadge email={email} />
    </aside>
  </div>;
}

function PrototypeHeader({ eyebrow, title, description, action }: { readonly eyebrow: string; readonly title: string; readonly description: string; readonly action: string }) {
  return <header className={styles.prototypeHeader}><div><span className={styles.kicker}>{eyebrow}</span><h1>{title}</h1><p>{description}</p></div><button className={styles.primaryAction}>{action}</button></header>;
}

function Metric({ value, label, detail, tone }: { readonly value: string; readonly label: string; readonly detail: string; readonly tone?: "alert" }) {
  return <article className={tone === "alert" ? styles.alertMetric : undefined}><strong>{value}</strong><div><span>{label}</span><small>{detail}</small></div></article>;
}

function SessionMatrix({ compact = false }: { readonly compact?: boolean }) {
  return <section className={`${styles.matrix} ${compact ? styles.compactMatrix : ""}`}>
    <div className={styles.matrixHeader}><span>Session</span><span>Time window</span><span>Certalis</span><span>Experience</span><span>Environment</span><span /></div>
    {sessions.map((session) => <article className={styles.matrixRow} key={session.name}>
      <div className={styles.identity}><span className={styles.sessionGlyph}>{session.name.slice(0, 1)}</span><div><strong>{session.name}</strong><small>{session.account} · {session.opportunity}</small></div></div>
      <div className={styles.timeCell}><strong>{session.time.split(" · ")[0]}</strong><span>{session.time.split(" · ")[1]}</span><small>Europe/London</small></div>
      <Pill text={session.operation} alert={session.attention} />
      <Pill text={session.experience} />
      <Pill text={session.environment} neutral />
      <button className={styles.rowAction} aria-label={`Open ${session.name}`}>→</button>
    </article>)}
    <footer className={styles.matrixFooter}><span>Showing 1–4 of 12 active sessions</span><div><button disabled>←</button><button>→</button></div></footer>
  </section>;
}

function Pill({ text, alert = false, neutral = false }: { readonly text: string; readonly alert?: boolean; readonly neutral?: boolean }) {
  return <span className={`${styles.pill} ${alert ? styles.pillAlert : ""} ${neutral ? styles.pillNeutral : ""}`}><i />{text}</span>;
}

function RightRail({ email, mode }: { readonly email: string; readonly mode: "dark" | "glass" }) {
  return <aside className={`${styles.rightRail} ${mode === "glass" ? styles.glassRail : ""}`}>
    <div className={styles.railBrand}><span>C</span><div><strong>Certalis</strong><small>Sales workspace</small></div></div>
    <nav aria-label="Prototype Sales navigation">
      <NavItem label="Sessions" icon="◫" active />
      <NavItem label="Relationships" icon="◇" />
      <NavItem label="Items" icon="□" />
      <NavItem label="Support" icon="?" />
    </nav>
    <div className={styles.railSpacer} />
    <div className={styles.connection}><i /><div><strong>CloudShare connected</strong><small>Observed 3 minutes ago</small></div></div>
    <UserBadge email={email} />
  </aside>;
}

function NavItem({ label, icon, active = false }: { readonly label: string; readonly icon: string; readonly active?: boolean }) {
  return <button className={active ? styles.navActive : undefined}><span>{icon}</span>{label}{active ? <i /> : null}</button>;
}

function UserBadge({ email }: { readonly email: string }) {
  return <div className={styles.userBadge}><span>SA</span><div><strong>Sales admin</strong><small>{email}</small></div><button aria-label="Account menu">⌄</button></div>;
}

function PrototypeSwitcher({ current }: { readonly current: Variant }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const currentIndex = variants.findIndex((item) => item.key === current);
  const select = (index: number) => {
    const params = new URLSearchParams(searchParams.toString());
    params.set("prototype", variants[(index + variants.length) % variants.length].key);
    router.replace(`/sales?${params.toString()}`, { scroll: false });
  };
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement;
      if (target.matches("input, textarea, [contenteditable]")) return;
      if (event.key === "ArrowLeft") select(currentIndex - 1);
      if (event.key === "ArrowRight") select(currentIndex + 1);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  });
  return <div className={styles.switcher} aria-label="Prototype variants">
    <button onClick={() => select(currentIndex - 1)} aria-label="Previous prototype">←</button>
    <span><small>PROTOTYPE</small><strong>{current} — {variants[currentIndex].name}</strong></span>
    <button onClick={() => select(currentIndex + 1)} aria-label="Next prototype">→</button>
  </div>;
}

export function parsePrototypeVariant(value: string | null): Variant | null {
  return process.env.NODE_ENV !== "production" && (value === "A" || value === "B" || value === "C") ? value : null;
}
