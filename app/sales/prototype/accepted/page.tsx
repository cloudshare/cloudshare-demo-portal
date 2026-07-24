"use client";

import { useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import styles from "./prototype.module.css";

const sessions = [
  { id: "northstar", name: "Northstar POV — July", account: "Northstar Bank", opportunity: "Cloud migration discovery", window: "2026-07-24 09:00–17:00 Europe/London", operation: "Correlated", experience: "In progress", environment: "Ready", attention: null },
  { id: "helios", name: "Helios solution workshop", account: "Helios CX", opportunity: "Contact centre transformation", window: "2026-07-25 14:00–16:00 Europe/London", operation: "Needs attention", experience: "Not started", environment: "Not observed", attention: "Session correlation requires review" },
  { id: "aperture", name: "Aperture platform review", account: "Aperture Group", opportunity: "Platform consolidation", window: "2026-07-25 13:00–15:30 Europe/London", operation: "Correlated", experience: "Not started", environment: "Scheduled", attention: null },
  { id: "vela", name: "Vela architecture session", account: "Vela Energy", opportunity: "Secure operations", window: "2026-07-28 10:00–12:00 Europe/London", operation: "Provisioning", experience: "Not started", environment: "Not assigned", attention: null },
];

const participants = [
  { name: "Maya Chen", email: "maya.chen@northstar.example", invitation: "Sent", environment: "Running", attention: "No attention required", action: "Open lab", verified: "2026-07-24 10:42 UTC" },
  { name: "Owen Patel", email: "owen.patel@northstar.example", invitation: "Not sent", environment: "Not created", attention: "Invitation required", action: "Send invite", verified: "Schedule prediction" },
  { name: "Lena Ortiz", email: "lena.ortiz@northstar.example", invitation: "Sent", environment: "Suspended", attention: "Environment suspended", action: "Resume access", verified: "2026-07-24 10:39 UTC" },
  { name: "Sam Wilson", email: "sam.wilson@northstar.example", invitation: "Resent", environment: "Ready", attention: "No attention required", action: "Copy instant link", verified: "2026-07-24 10:41 UTC" },
  { name: "Priya Nair", email: "priya.nair@northstar.example", invitation: "Sent", environment: "Provisioning", attention: "Provisioning for 8 minutes", action: "View progress", verified: "2026-07-24 10:40 UTC" },
  { name: "Elliot Brooks", email: "elliot.brooks@northstar.example", invitation: "Bounced", environment: "Not created", attention: "Email delivery failed", action: "Fix invitation", verified: "Schedule prediction" },
];

export default function AcceptedSalesPrototype() {
  const router = useRouter();
  const params = useSearchParams();
  const sessionId = params.get("session");
  const selectedSession = sessions.find((session) => session.id === sessionId) ?? sessions[0];
  const openSession = (id: string) => router.push(`/sales/prototype/accepted?session=${id}`);
  const returnToQueue = () => router.push("/sales/prototype/accepted");

  return <div className={styles.app}>
    <aside className={styles.leftNav}>
      <div className={styles.brand}><span>C</span><div><strong>Certalis</strong><small>Sales workspace</small></div></div>
      <nav aria-label="Sales workspace">
        <button className={styles.activeNav}><span>▣</span>Sessions</button>
        <button><span>◇</span>Relationships</button>
        <button><span>□</span>Items</button>
        <button><span>?</span>Support</button>
      </nav>
      <div className={styles.navSpacer} />
      <div className={styles.user}><span>SA</span><div><strong>Sales admin</strong><small>sales-admin@certalis.demo</small></div></div>
    </aside>

    <main className={styles.main}>
      <div className={styles.prototypeNotice}>THROWAWAY PROTOTYPE · accepted #376/#377 synthesis · representative data only</div>
      {sessionId ? <SessionWorkspace session={selectedSession} onBack={returnToQueue} /> : <SessionWorkbench onOpen={openSession} />}
    </main>
  </div>;
}

function SessionWorkbench({ onOpen }: { readonly onOpen: (id: string) => void }) {
  const [view, setView] = useState<"active" | "attention" | "history">("active");
  const [search, setSearch] = useState("");
  const visible = useMemo(() => sessions.filter((session) => {
    if (view === "attention" && !session.attention) return false;
    if (view === "history") return false;
    return `${session.name} ${session.account} ${session.opportunity}`.toLowerCase().includes(search.toLowerCase());
  }), [search, view]);

  return <>
    <header className={styles.pageHeader}>
      <div><p className={styles.eyebrow}>Sales operations</p><h1>Sessions</h1><p>Scan, filter, and triage Customer experiences.</p></div>
      <button className={styles.primary}>Provision a Session</button>
    </header>

    <section className={styles.workbench} aria-label="Session workbench">
      <div className={styles.queueTabs} aria-label="Session queue views">
        <button aria-pressed={view === "active"} onClick={() => setView("active")}>Active <span>12</span></button>
        <button aria-pressed={view === "attention"} onClick={() => setView("attention")}>Needs attention <span>2</span></button>
        <button aria-pressed={view === "history"} onClick={() => setView("history")}>History</button>
      </div>
      <div className={styles.filters}>
        <label>Account<select><option>All Accounts</option><option>Northstar Bank</option><option>Helios CX</option></select></label>
        <label>Opportunity<select><option>All Opportunities</option></select></label>
        <label className={styles.search}>Search<input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Sessions, Accounts, or Opportunities" /></label>
        <label>Sort<select><option>Start time, newest first</option></select></label>
      </div>
      <div className={styles.queueMeta}><strong>{view === "active" ? "Active Sessions" : view === "attention" ? "Sessions needing attention" : "Session history"}</strong><span>{visible.length} results</span></div>
      <div className={styles.tableWrap}>
        <table className={styles.table}>
          <thead><tr><th>Session</th><th>Time window</th><th>Certalis operation</th><th>CloudShare Experience</th><th>Participant Environment</th><th>Attention</th><th><span className={styles.srOnly}>Open</span></th></tr></thead>
          <tbody>{visible.map((session) => <tr key={session.id}>
            <td><button className={styles.sessionName} onClick={() => onOpen(session.id)}>{session.name}</button><small>{session.account}<br />{session.opportunity}</small></td>
            <td>{session.window}</td>
            <td><Status text={session.operation} warning={session.operation === "Needs attention"} /></td>
            <td><Status text={session.experience} /><small>Observed from CloudShare</small></td>
            <td><Status text={session.environment} neutral /></td>
            <td className={session.attention ? styles.attention : styles.muted}>{session.attention ?? "No attention required"}</td>
            <td><button className={styles.openButton} onClick={() => onOpen(session.id)} aria-label={`Open ${session.name}`}>→</button></td>
          </tr>)}</tbody>
        </table>
      </div>
      {!visible.length ? <div className={styles.empty}>No Sessions in this view.</div> : null}
      <footer className={styles.footer}><span>Showing {visible.length} of {visible.length}</span><div><button disabled>Previous</button><button disabled>Next</button></div></footer>
    </section>
  </>;
}

function SessionWorkspace({ session, onBack }: { readonly session: (typeof sessions)[number]; readonly onBack: () => void }) {
  const [inspected, setInspected] = useState(participants[0]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [anchor, setAnchor] = useState<number | null>(null);
  const rowRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const allPageSelected = selected.size === participants.length;
  const selectRow = (index: number, options: { readonly additive?: boolean; readonly range?: boolean } = {}) => {
    const participant = participants[index];
    setInspected(participant);
    setSelected((current) => {
      if (options.range && anchor !== null) {
        const next = new Set(current);
        for (let row = Math.min(anchor, index); row <= Math.max(anchor, index); row += 1) next.add(participants[row].email);
        return next;
      }
      const next = options.additive ? new Set(current) : new Set<string>();
      if (next.has(participant.email)) next.delete(participant.email); else next.add(participant.email);
      return next;
    });
    setAnchor(index);
  };
  const selectCurrentPage = () => setSelected(allPageSelected ? new Set() : new Set(participants.map((participant) => participant.email)));

  return <>
    <button className={styles.back} onClick={onBack}>← Back to Sessions</button>
    <header className={styles.sessionHeader}>
      <div><p className={styles.eyebrow}>Active · {session.experience}</p><h1>{session.name}</h1><p>{session.account} · {session.opportunity}<br />{session.window}</p></div>
      <div className={styles.headerActions}><button>Verify now</button><button>More actions ▾</button></div>
    </header>
    <div className={styles.localNav}><button aria-current="page">Participants</button><button>Activity</button><button>Details</button></div>
    <div className={styles.stickyStatus}><span><i />CloudShare observed 4 minutes ago</span><span>Automatic refresh is healthy</span></div>

    <section className={styles.participantSurface}>
      <div className={styles.participantToolbar}>
        <input aria-label="Search participants" placeholder="Search participant name or email" />
        <select aria-label="Environment filter"><option>All environments</option><option>Needs attention</option></select>
        <span>{participants.length} participants</span>
      </div>
      {selected.size ? <div className={styles.bulkBar} role="status">
        <strong>{selected.size} participant{selected.size === 1 ? "" : "s"} selected</strong>
        <div><button>Send eligible invitations</button><button>Copy eligible launch links</button><button onClick={() => setSelected(new Set())}>Clear selection</button></div>
      </div> : null}
      <div className={styles.participantLayout}>
        <div className={styles.participantList}>
          <div className={styles.participantHead}>
            <span><input type="checkbox" aria-label="Select all participants on this page" checked={allPageSelected} onChange={selectCurrentPage} /></span>
            <span>Participant</span><span>Invitation</span><span>Environment</span><span>Attention</span><span>Primary action</span>
          </div>
          {participants.map((participant, index) => <button
            key={participant.email}
            ref={(node) => { rowRefs.current[index] = node; }}
            className={inspected.email === participant.email ? styles.inspectedRow : styles.participantRow}
            aria-pressed={selected.has(participant.email)}
            onClick={(event) => selectRow(index, { additive: event.ctrlKey || event.metaKey, range: event.shiftKey })}
            onKeyDown={(event) => {
              if (event.key === "ArrowDown") { event.preventDefault(); rowRefs.current[Math.min(participants.length - 1, index + 1)]?.focus(); }
              if (event.key === "ArrowUp") { event.preventDefault(); rowRefs.current[Math.max(0, index - 1)]?.focus(); }
              if (event.key === " ") { event.preventDefault(); selectRow(index, { additive: true, range: event.shiftKey }); }
              if (event.key === "Enter") setInspected(participant);
            }}
          >
            <span className={styles.check}>{selected.has(participant.email) ? "☑" : "☐"}</span>
            <span><strong>{participant.name}</strong><small>{participant.email}</small></span>
            <span>{participant.invitation}</span>
            <span><Status text={participant.environment} neutral /></span>
            <span className={participant.attention === "No attention required" ? styles.muted : styles.attention}>{participant.attention}</span>
            <span className={styles.inlineAction}>{participant.action}</span>
          </button>)}
          <footer className={styles.participantFooter}><span>{selected.size} selected · Rows 1–6 of 248</span>{allPageSelected ? <button>Select all 248 matching participants</button> : <span>Shift-click selects a range</span>}</footer>
        </div>
        <aside className={styles.inspector}>
          <p className={styles.eyebrow}>Participant inspector</p>
          <h2>{inspected.name}</h2><p>{inspected.email}</p>
          <dl><div><dt>Invitation</dt><dd>{inspected.invitation}</dd></div><div><dt>Environment</dt><dd>{inspected.environment}</dd></div><div><dt>Last verified</dt><dd>{inspected.verified}</dd></div></dl>
          <button className={styles.primary}>{inspected.action}</button>
          <button>View activity</button><button>Open diagnostics</button>
        </aside>
      </div>
    </section>
  </>;
}

function Status({ text, warning = false, neutral = false }: { readonly text: string; readonly warning?: boolean; readonly neutral?: boolean }) {
  return <span className={`${styles.status} ${warning ? styles.warning : ""} ${neutral ? styles.neutral : ""}`}><i />{text}</span>;
}
