"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import styles from "./prototype.module.css";

type Variant = "A" | "B" | "C";

const variants: Array<{ key: Variant; label: string }> = [
  { key: "A", label: "Conventional table" },
  { key: "B", label: "Spreadsheet grid" },
  { key: "C", label: "Dense hybrid" },
];

const participants = [
  { name: "Maya Chen", email: "maya.chen@northstar.example", invitation: "Sent", environment: "Running", access: "Open lab", attention: "—", verified: "10:42 UTC" },
  { name: "Owen Patel", email: "owen.patel@northstar.example", invitation: "Not sent", environment: "Not created", access: "Send invite", attention: "Invitation required", verified: "Schedule only" },
  { name: "Lena Ortiz", email: "lena.ortiz@northstar.example", invitation: "Sent", environment: "Suspended", access: "Resume access", attention: "Environment suspended", verified: "10:39 UTC" },
  { name: "Sam Wilson", email: "sam.wilson@northstar.example", invitation: "Resent", environment: "Ready", access: "Copy instant link", attention: "—", verified: "10:41 UTC" },
  { name: "Priya Nair", email: "priya.nair@northstar.example", invitation: "Sent", environment: "Provisioning", access: "View progress", attention: "Provisioning 8 min", verified: "10:40 UTC" },
  { name: "Elliot Brooks", email: "elliot.brooks@northstar.example", invitation: "Bounced", environment: "Not created", access: "Fix invitation", attention: "Email delivery failed", verified: "Schedule only" },
];

function PrototypeSwitcher({ current }: { current: Variant }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const move = (delta: number) => {
    const index = variants.findIndex((variant) => variant.key === current);
    const next = variants[(index + delta + variants.length) % variants.length];
    const params = new URLSearchParams(searchParams?.toString() ?? "");
    params.set("variant", next.key);
    router.replace(`${pathname}?${params.toString()}`);
  };

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target?.matches("input, textarea, [contenteditable='true'], select")) return;
      if (event.key === "ArrowLeft" && event.altKey) {
        event.preventDefault();
        move(-1);
      }
      if (event.key === "ArrowRight" && event.altKey) {
        event.preventDefault();
        move(1);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  });

  const active = variants.find((variant) => variant.key === current)!;
  return (
    <div className={styles.switcher} aria-label="Prototype variants">
      <button onClick={() => move(-1)} aria-label="Previous variant">←</button>
      <strong>{active.key} — {active.label}</strong>
      <button onClick={() => move(1)} aria-label="Next variant">→</button>
      <span>Alt + ←/→</span>
    </div>
  );
}

function Shell({ children, variant }: { children: React.ReactNode; variant: Variant }) {
  return (
    <div className={styles.app}>
      <aside className={styles.rail}>
        <div className={styles.brand}>Certalis</div>
        <nav aria-label="Sales workspace">
          <a className={styles.activeNav} href="#">Sessions</a>
          <a href="#">Relationships</a>
          <a href="#">Items</a>
          <a href="#">Support</a>
        </nav>
        <div className={styles.user}>Certalis Sales Admin</div>
      </aside>
      <main className={styles.main}>
        <div className={styles.breadcrumb}>Sessions / Northstar POV — July</div>
        <header className={styles.sessionHeader}>
          <div>
            <p className={styles.eyebrow}>Active · In progress</p>
            <h1>Northstar POV — July</h1>
            <p>2026-07-23 09:00–17:00 Europe/London · 6 participants</p>
          </div>
          <div className={styles.headerActions}>
            <button>Verify CloudShare status</button>
            <button className={styles.more}>More actions ▾</button>
          </div>
        </header>
        <div className={styles.localNav}>
          <a className={styles.localActive} href="#">Participants</a>
          <a href="#">Activity</a>
          <a href="#">Details</a>
        </div>
        {children}
      </main>
      <PrototypeSwitcher current={variant} />
    </div>
  );
}

function Toolbar({ dense = false }: { dense?: boolean }) {
  return (
    <div className={dense ? styles.denseToolbar : styles.toolbar}>
      <label>
        <span className={styles.srOnly}>Search participants</span>
        <input placeholder="Search name or email" />
      </label>
      <select aria-label="Environment filter" defaultValue="all">
        <option value="all">All environments</option>
        <option>Needs attention</option>
        <option>Running</option>
        <option>Suspended</option>
      </select>
      <button disabled>Bulk actions</button>
      <span className={styles.resultCount}>6 participants</span>
    </div>
  );
}

function ConventionalTable() {
  const [selected, setSelected] = useState<(typeof participants)[number] | null>(null);
  return (
    <section className={styles.surface}>
      <div className={styles.variantIntro}>
        <strong>A — Conventional table</strong>
        <span>Tab through links and controls; Enter opens participant detail.</span>
      </div>
      <Toolbar />
      <div className={styles.tableWrap}>
        <table className={styles.table}>
          <thead><tr><th><span className={styles.srOnly}>Select</span></th><th>Participant</th><th>Invitation</th><th>Environment</th><th>Attention</th><th>Verified</th><th>Primary action</th></tr></thead>
          <tbody>
            {participants.map((participant) => (
              <tr key={participant.email}>
                <td><input type="checkbox" aria-label={`Select ${participant.name}`} /></td>
                <td><button className={styles.nameLink} onClick={() => setSelected(participant)}>{participant.name}</button><small>{participant.email}</small></td>
                <td>{participant.invitation}</td>
                <td><span className={styles.status}>{participant.environment}</span></td>
                <td>{participant.attention}</td>
                <td>{participant.verified}</td>
                <td><button className={styles.primary}>{participant.access}</button></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {selected && <DetailSheet participant={selected} onClose={() => setSelected(null)} />}
    </section>
  );
}

function SpreadsheetGrid() {
  const refs = useRef<Array<HTMLButtonElement | null>>([]);
  const [activeCell, setActiveCell] = useState(0);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [anchor, setAnchor] = useState<number | null>(null);
  const columns = 7;
  const cells = useMemo(() => participants.flatMap((p) => ["select", p.name, p.invitation, p.environment, p.attention, p.verified, p.access]), []);

  const focusCell = (index: number) => {
    const next = Math.max(0, Math.min(cells.length - 1, index));
    setActiveCell(next);
    refs.current[next]?.focus();
  };

  const toggleRow = (rowIndex: number, range = false) => {
    setSelected((current) => {
      const next = new Set(current);
      if (range && anchor !== null) {
        const start = Math.min(anchor, rowIndex);
        const end = Math.max(anchor, rowIndex);
        for (let index = start; index <= end; index += 1) next.add(index);
      } else if (next.has(rowIndex)) next.delete(rowIndex);
      else next.add(rowIndex);
      return next;
    });
    setAnchor(rowIndex);
  };

  const allSelected = selected.size === participants.length;

  return (
    <section className={`${styles.surface} ${styles.gridSurface}`}>
      <div className={styles.variantIntro}>
        <strong>B — Spreadsheet grid</strong>
        <span>Arrow between cells; Enter activates the focused cell; Space selects a row.</span>
      </div>
      <Toolbar dense />
      <div className={styles.gridHelp}>Cell {Math.floor(activeCell / columns) + 1}:{(activeCell % columns) + 1} · Use arrow keys to move</div>
      <div className={styles.dataGrid} role="grid" aria-label="Participants spreadsheet grid">
        <div className={styles.gridHeader} role="row">
          <div role="columnheader">
            <input
              type="checkbox"
              aria-label="Select all participants on this page"
              checked={allSelected}
              onChange={() => setSelected(allSelected ? new Set() : new Set(participants.map((_, index) => index)))}
            />
          </div>
          {["Participant", "Invitation", "Environment", "Attention", "Verified", "Primary action", "More"].map((label) => <div role="columnheader" key={label}>{label}</div>)}
        </div>
        {participants.map((participant, rowIndex) => (
          <div className={`${styles.gridRow} ${selected.has(rowIndex) ? styles.selectedGridRow : ""}`} role="row" aria-selected={selected.has(rowIndex)} key={participant.email}>
            {["select", participant.name, participant.invitation, participant.environment, participant.attention, participant.verified, participant.access].map((value, columnIndex) => {
              const index = rowIndex * columns + columnIndex;
              return (
                <button
                  key={`${participant.email}-${columnIndex}`}
                  role="gridcell"
                  tabIndex={index === activeCell ? 0 : -1}
                  ref={(node) => { refs.current[index] = node; }}
                  onFocus={() => setActiveCell(index)}
                  onKeyDown={(event) => {
                    if (event.key === "ArrowRight") { event.preventDefault(); focusCell(index + 1); }
                    if (event.key === "ArrowLeft") { event.preventDefault(); focusCell(index - 1); }
                    if (event.key === "ArrowDown") { event.preventDefault(); focusCell(index + columns); }
                    if (event.key === "ArrowUp") { event.preventDefault(); focusCell(index - columns); }
                    if (event.key === "Home") { event.preventDefault(); focusCell(rowIndex * columns); }
                    if (event.key === "End") { event.preventDefault(); focusCell(rowIndex * columns + columns - 1); }
                    if (event.key === " " && columnIndex === 0) { event.preventDefault(); toggleRow(rowIndex, event.shiftKey); }
                  }}
                  onClick={(event) => {
                    if (columnIndex === 0) toggleRow(rowIndex, event.shiftKey);
                  }}
                  className={columnIndex === 6 ? styles.gridAction : undefined}
                >
                  {columnIndex === 0 ? (selected.has(rowIndex) ? "☑" : "☐") : value}
                  {columnIndex === 1 && <small>{participant.email}</small>}
                </button>
              );
            })}
            <div className={styles.gridActionMenu}>
              <select aria-label={`More actions for ${participant.name}`} defaultValue="">
                <option value="" disabled>More…</option>
                <option>View activity</option>
                <option>Open diagnostics</option>
                <option>View participant detail</option>
              </select>
            </div>
          </div>
        ))}
      </div>
      <div className={styles.gridFooter}>
        Rows 1–6 of 248 · {selected.size} selected · Shift + Space selects a range
        {allSelected && <button className={styles.selectAllMatching}>Select all 248 matching participants</button>}
      </div>
    </section>
  );
}

function DenseHybrid() {
  const [inspected, setInspected] = useState(participants[0]);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [anchor, setAnchor] = useState<number | null>(null);
  const allSelected = selected.size === participants.length;

  const selectRow = (index: number, event: React.MouseEvent) => {
    setInspected(participants[index]);
    setSelected((current) => {
      if (event.shiftKey && anchor !== null) {
        const next = new Set(current);
        for (let row = Math.min(anchor, index); row <= Math.max(anchor, index); row += 1) next.add(row);
        return next;
      }
      if (event.ctrlKey || event.metaKey) {
        const next = new Set(current);
        if (next.has(index)) next.delete(index);
        else next.add(index);
        return next;
      }
      return new Set([index]);
    });
    setAnchor(index);
  };

  return (
    <section className={`${styles.surface} ${styles.hybrid}`}>
      <div className={styles.variantIntro}>
        <strong>C — Dense hybrid</strong>
        <span>Compact sortable rows use conventional focus; the inspector stays visible.</span>
      </div>
      <Toolbar dense />
      <div className={styles.hybridBody}>
        <div className={styles.compactList}>
          <div className={styles.compactHeader}>
            <input
              type="checkbox"
              aria-label="Select all participants on this page"
              checked={allSelected}
              onChange={() => setSelected(allSelected ? new Set() : new Set(participants.map((_, index) => index)))}
            />
            <span>Participant ↕</span><span>Environment ↕</span><span>Attention</span><span>Action</span>
          </div>
          {participants.map((participant, index) => (
            <button
              key={participant.email}
              aria-pressed={selected.has(index)}
              className={selected.has(index) ? styles.selectedCompact : styles.compactRow}
              onClick={(event) => selectRow(index, event)}
            >
              <span className={styles.rowCheck}>{selected.has(index) ? "☑" : "☐"}</span>
              <span><strong>{participant.name}</strong><small>{participant.email}</small></span>
              <span>{participant.environment}</span>
              <span>{participant.attention}</span>
              <span className={styles.inlineAction}>{participant.access}</span>
            </button>
          ))}
          <div className={styles.compactFooter}>
            {selected.size} selected
            {allSelected && <button>Select all 248 matching participants</button>}
          </div>
        </div>
        <aside className={styles.inspector}>
          <p className={styles.eyebrow}>Participant inspector</p>
          <h2>{inspected.name}</h2>
          <p>{inspected.email}</p>
          <dl>
            <div><dt>Invitation</dt><dd>{inspected.invitation}</dd></div>
            <div><dt>Environment</dt><dd>{inspected.environment}</dd></div>
            <div><dt>Last verified</dt><dd>{inspected.verified}</dd></div>
          </dl>
          <button className={styles.primary}>{inspected.access}</button>
          <button>View activity</button>
          <button>Open diagnostics</button>
        </aside>
      </div>
    </section>
  );
}

function DetailSheet({ participant, onClose }: { participant: (typeof participants)[number]; onClose: () => void }) {
  const closeRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    closeRef.current?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);
  return (
    <aside className={styles.sheet} aria-label={`${participant.name} details`}>
      <button ref={closeRef} className={styles.sheetClose} onClick={onClose}>Close ×</button>
      <p className={styles.eyebrow}>Participant detail</p>
      <h2>{participant.name}</h2>
      <p>{participant.email}</p>
      <dl>
        <div><dt>Invitation</dt><dd>{participant.invitation}</dd></div>
        <div><dt>Environment</dt><dd>{participant.environment}</dd></div>
        <div><dt>Attention</dt><dd>{participant.attention}</dd></div>
        <div><dt>Last verified</dt><dd>{participant.verified}</dd></div>
      </dl>
      <button className={styles.primary}>{participant.access}</button>
      <button>View activity</button>
      <button>Open diagnostics</button>
    </aside>
  );
}

export default function ParticipantsPrototype() {
  const searchParams = useSearchParams();
  const raw = searchParams?.get("variant");
  const variant: Variant = raw === "B" || raw === "C" ? raw : "A";
  return (
    <Shell variant={variant}>
      {variant === "A" && <ConventionalTable />}
      {variant === "B" && <SpreadsheetGrid />}
      {variant === "C" && <DenseHybrid />}
    </Shell>
  );
}
