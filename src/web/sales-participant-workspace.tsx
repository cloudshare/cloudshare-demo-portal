"use client";

import { SalesParticipantExtension } from "./sales-participant-extension";
import React, { useCallback, useEffect, useRef, useState } from "react";
import styles from "./sales-session-workspace.module.css";
import { primaryButtonStyle, secondaryButtonStyle } from "./button-styles";
import type { SalesParticipantWorkspaceRow } from "@/domain/sales-participant-workspace";
import type { InvitationOutcome, InvitationSafeReason } from "@/domain/sales-participant-workspace";
import type { SalesParticipantLaunchOperationKind, SalesParticipantLaunchOutcome } from "@/domain/sales-participant-launch-operation";
import { classifyParticipantAddRecovery, participantAddRecovery } from "@/domain/participant-add-recovery";
import {
  pruneParticipantSelection,
  reduceParticipantSelection,
  type ParticipantSelectionState,
} from "@/domain/sales-participant-workspace";

type ParticipantPage = {
  readonly participants: readonly SalesParticipantWorkspaceRow[];
  readonly total: number;
  readonly offset: number;
  readonly limit: number;
  readonly hasMore: boolean;
  readonly eligibleContacts?: readonly { readonly id: string; readonly name: string; readonly email: string }[];
};
type Action = "invite" | "resend" | "generate_launch" | "revoke_launch";
type ParticipantAddPerson = { kind: "existingContact"; contactId: string } | { kind: "adHoc"; firstName: string; lastName: string; email: string };

export function SalesParticipantWorkspace(props: {
  readonly sessionId: string;
  readonly active: boolean;
  readonly cancelled?: boolean;
  readonly onAccessConfirmed?: () => Promise<void>;
  readonly request: (url: string, init?: RequestInit) => Promise<Response>;
}) {
  const { sessionId, active, request } = props;
  const [page, setPage] = useState<ParticipantPage | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const initial = typeof window === "undefined" ? null : new URLSearchParams(window.location.search);
  const [query, setQuery] = useState(initial?.get("participantQuery") ?? "");
  const [offset, setOffset] = useState(Number(initial?.get("participantOffset") ?? 0) || 0);
  const [selection, setSelection] = useState<ParticipantSelectionState>(() => {
    if (typeof window === "undefined") return { activeId: null, selectedIds: [], rangeAnchorId: null };
    const params = new URLSearchParams(window.location.search);
    return { activeId: params.get("participantActive"), selectedIds: (params.get("participantSelected") ?? "").split(",").filter(Boolean).slice(0, 25), rangeAnchorId: params.get("participantAnchor") };
  });
  const [inspectorOpen, setInspectorOpen] = useState(() => typeof window !== "undefined" && new URLSearchParams(window.location.search).get("participantFocus") === "inspector" && Boolean(new URLSearchParams(window.location.search).get("participantActive")));
  const [feedback, setFeedback] = useState<Record<string, string>>({});
  const [generatedLaunch, setGeneratedLaunch] = useState<{ sessionId: string; participantId: string; url: string } | null>(null);
  const inspectorRef = useRef<HTMLElement>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const [revokeTarget, setRevokeTarget] = useState<SalesParticipantWorkspaceRow | null>(null);
  const [focusAfterReread, setFocusAfterReread] = useState<string | null>(null);
  const [addMode, setAddMode] = useState<"existingContact" | "adHoc">("existingContact");
  const [registrationId, setRegistrationId] = useState("");
  const [adHoc, setAdHoc] = useState({ firstName: "", lastName: "", email: "" });
  const [registrationFeedback, setRegistrationFeedback] = useState<string | null>(null);
  const [registrationOutcome, setRegistrationOutcome] = useState<{ retryable: boolean; correlationId: string | null; nextRetryAt?: string; nextAction?: "retry" | "reconcile" } | null>(null);
  const registrationCommand = useRef<{ key: string; commandId: string } | null>(null);
  const automaticRetryCount = useRef(0);
  const automaticRetryMode = useRef<"quick" | "reconciled">("quick");
  const automaticRetryTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const registrationGeneration = useRef(0);
  const [registrationBusy, setRegistrationBusy] = useState(false);
  const originRef = useRef<HTMLElement | null>(null);
  const clearedInspectorTarget = useRef(false);
  const historyMode = useRef<"push" | "replace">("replace");
  const lastUrl = useRef<string | null>(null);
  const logicalFocus = useRef<"row" | "inspector">(typeof window !== "undefined" && new URLSearchParams(window.location.search).get("participantFocus") === "inspector" ? "inspector" : "row");
  const pageReadGeneration = useRef(0);
  const href = useCallback(() => `/api/sales/enablement-sessions/${encodeURIComponent(sessionId)}/participants?${query ? `query=${encodeURIComponent(query)}&` : ""}offset=${offset}&limit=25`, [offset, query, sessionId]);
  const activeParticipant = page?.participants.find((row) => row.id === selection.activeId) ?? null;

  useEffect(() => {
    if (active) headingRef.current?.focus();
  }, [active]);
  useEffect(() => {
    registrationGeneration.current += 1;
    registrationCommand.current = null;
    automaticRetryCount.current = 0;
    automaticRetryMode.current = "quick";
    setRegistrationOutcome(null);
    setRegistrationFeedback(null);
    setRegistrationBusy(false);
    setRegistrationId("");
    setAdHoc({ firstName: "", lastName: "", email: "" });
    return () => {
      registrationGeneration.current += 1;
      if (automaticRetryTimer.current) { clearTimeout(automaticRetryTimer.current); automaticRetryTimer.current = null; }
      automaticRetryCount.current = 0;
    };
  }, [sessionId]);
  useEffect(() => {
    const onPop = () => { const params = new URLSearchParams(window.location.search); const inspector = params.get("participantFocus") === "inspector" && Boolean(params.get("participantActive")); clearedInspectorTarget.current = false; historyMode.current = "replace"; lastUrl.current = window.location.href; setQuery(params.get("participantQuery") ?? ""); setOffset(Number(params.get("participantOffset") ?? 0) || 0); setSelection({ activeId: params.get("participantActive"), selectedIds: (params.get("participantSelected") ?? "").split(",").filter(Boolean).slice(0, 25), rangeAnchorId: params.get("participantAnchor") }); logicalFocus.current = inspector ? "inspector" : "row"; setInspectorOpen(inspector); const scrollY = window.history.state?.participantScrollY; if (typeof scrollY === "number" && typeof window.scrollTo === "function") window.scrollTo(0, scrollY); };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);
  useEffect(() => {
    if (!active) return;
    const url = new URL(window.location.href); query ? url.searchParams.set("participantQuery", query) : url.searchParams.delete("participantQuery"); offset ? url.searchParams.set("participantOffset", String(offset)) : url.searchParams.delete("participantOffset"); selection.activeId ? url.searchParams.set("participantActive", selection.activeId) : url.searchParams.delete("participantActive"); selection.selectedIds.length ? url.searchParams.set("participantSelected", selection.selectedIds.slice(0, 25).join(",")) : url.searchParams.delete("participantSelected"); selection.rangeAnchorId ? url.searchParams.set("participantAnchor", selection.rangeAnchorId) : url.searchParams.delete("participantAnchor"); url.searchParams.set("participantFocus", logicalFocus.current);
    const nextUrl = url.toString();
    if (lastUrl.current === nextUrl) return;
    if (historyMode.current === "push") {
      window.history.replaceState({ ...window.history.state, participantScrollY: window.scrollY }, "", window.location.href);
      window.history.pushState({ participantScrollY: window.scrollY }, "", url);
    } else {
      window.history.replaceState({ ...window.history.state, participantScrollY: window.scrollY }, "", url);
    }
    lastUrl.current = nextUrl;
    historyMode.current = "replace";
  }, [active, inspectorOpen, offset, query, selection]);
  useEffect(() => {
    setGeneratedLaunch((current) => current && (current.sessionId !== sessionId || current.participantId !== selection.activeId) ? null : current);
  }, [selection.activeId, sessionId]);
  useEffect(() => {
    if (!active) return;
    let disposed = false;
    const readGeneration = ++pageReadGeneration.current;
    void request(href(), { cache: "no-store" }).then(async (response) => {
      if (disposed || pageReadGeneration.current !== readGeneration) return;
      const body = (await response.json()) as ParticipantPage;
      if (disposed || pageReadGeneration.current !== readGeneration) return;
      if (!response.ok || !Array.isArray(body.participants)) { setLoadFailed(true); setPage(null); setFeedback((current) => ({ ...current, _announcement: "Participant roster could not be loaded; retry or open Support." })); return; }
      setLoadFailed(false);
      setPage(body);
      setSelection((current) => {
        const pageIds = body.participants.map((row) => row.id);
        const inspectorTargetMissing = inspectorOpen && Boolean(current.activeId) && !pageIds.includes(current.activeId as string);
        const pruned = pruneParticipantSelection(current, pageIds);
        const next = inspectorTargetMissing || (clearedInspectorTarget.current && current.activeId === null) ? { ...pruned, activeId: null } : pruned;
        if (current.activeId !== next.activeId || current.rangeAnchorId !== next.rangeAnchorId || current.selectedIds.join(",") !== next.selectedIds.join(",")) {
          historyMode.current = "replace";
          if (current.activeId || current.rangeAnchorId || current.selectedIds.length) setFeedback((messages) => ({ ...messages, _announcement: "The Participant roster changed; the previous selection is no longer visible." }));
        }
        if (inspectorTargetMissing) {
          clearedInspectorTarget.current = true;
          logicalFocus.current = "row";
          originRef.current = headingRef.current;
          setInspectorOpen(false);
          queueMicrotask(() => headingRef.current?.focus());
        }
        return next;
      });
    }).catch(() => { if (!disposed && pageReadGeneration.current === readGeneration) { setLoadFailed(true); setPage(null); setFeedback((messages) => ({ ...messages, _announcement: "Participant roster could not be loaded; retry or open Support." })); } });
    return () => { disposed = true; pageReadGeneration.current += 1; };
  }, [active, href, inspectorOpen, offset, query, request, props.cancelled]);
  useEffect(() => {
    if (!inspectorOpen || !selection.activeId || !page || page.participants.some((participant) => participant.id === selection.activeId)) return;
    const missingId = selection.activeId;
    historyMode.current = "replace";
    clearedInspectorTarget.current = true;
    logicalFocus.current = "row";
    originRef.current = headingRef.current;
    setInspectorOpen(false);
    setSelection((current) => current.activeId === missingId
      ? { ...pruneParticipantSelection(current, page.participants.map((participant) => participant.id)), activeId: null }
      : current);
    queueMicrotask(() => headingRef.current?.focus());
  }, [inspectorOpen, page, selection.activeId]);
  useEffect(() => {
    if (inspectorOpen) inspectorRef.current?.focus();
    else if (logicalFocus.current === "row" && selection.activeId && !(document.activeElement instanceof HTMLButtonElement || document.activeElement instanceof HTMLInputElement)) Array.from(document.querySelectorAll<HTMLElement>("tr[data-participant-id]")).find((row) => row.dataset.participantId === selection.activeId)?.focus();
  }, [activeParticipant?.id, inspectorOpen, selection.activeId]);
  useEffect(() => {
    if (!focusAfterReread) return;
    const preferred = originRef.current;
    const primaryAction = inspectorRef.current?.querySelector<HTMLElement>('[role="group"][aria-label="Participant actions"] [data-primary-action="true"]:not([disabled])');
    const currentAction = primaryAction ?? inspectorRef.current?.querySelector<HTMLElement>('[role="group"][aria-label="Participant actions"] button:not([disabled])');
    const currentRow = Array.from(document.querySelectorAll<HTMLElement>("tr[data-participant-id]")).find((row) => row.dataset.participantId === focusAfterReread);
    const target = safelyFocusable(preferred) ? preferred : safelyFocusable(currentAction) ? currentAction : safelyFocusable(currentRow) ? currentRow : headingRef.current;
    target?.focus();
    setFocusAfterReread(null);
  }, [focusAfterReread, page]);

  const openInspector = (participantId: string, origin: HTMLElement | null) => {
    clearedInspectorTarget.current = false;
    historyMode.current = "push";
    logicalFocus.current = "inspector";
    originRef.current = origin?.closest<HTMLElement>("tr[data-participant-id]") ?? headingRef.current;
    setSelection((state) => ({ ...state, activeId: participantId }));
    setInspectorOpen(true);
  };
  const closeInspector = () => {
    historyMode.current = "push";
    logicalFocus.current = "row";
    setInspectorOpen(false);
    queueMicrotask(() => (originRef.current ?? headingRef.current)?.focus());
  };

  const rereadWorkspace = async () => {
    const readGeneration = ++pageReadGeneration.current;
    try {
      const response = await request(href(), { cache: "no-store" });
      const next = await readJsonObject(response);
      if (pageReadGeneration.current !== readGeneration) return false;
      if (response.ok && Array.isArray(next?.participants)) { setPage(next as ParticipantPage); return true; }
    } catch {
      // Action feedback is more useful than replacing it with a secondary reread failure.
    }
    return false;
  };
  const startNewRegistrationTarget = () => {
    registrationGeneration.current += 1;
    if (automaticRetryTimer.current) { clearTimeout(automaticRetryTimer.current); automaticRetryTimer.current = null; }
    automaticRetryCount.current = 0;
    automaticRetryMode.current = "quick";
    registrationCommand.current = null;
    setRegistrationOutcome(null);
    setRegistrationFeedback(null);
    setRegistrationBusy(false);
  };
  const registerSelected = async (forceNewCommand = false, automaticPerson?: ParticipantAddPerson) => {
    const generation = registrationGeneration.current;
    const selectedId = registrationId;
    const person: ParticipantAddPerson = automaticPerson ?? (addMode === "existingContact" ? { kind: "existingContact", contactId: selectedId } : { kind: "adHoc", ...adHoc });
    if (registrationBusy || (person.kind === "existingContact" ? !person.contactId : !person.firstName.trim() || !person.lastName.trim() || !person.email.trim())) return;
    setRegistrationBusy(true); setRegistrationOutcome(null);
    setRegistrationFeedback("Registering…");
    try {
      const key = JSON.stringify(person);
      const commandId = !forceNewCommand && registrationCommand.current?.key === key ? registrationCommand.current.commandId : crypto.randomUUID();
      registrationCommand.current = { key, commandId };
      const response = await request(`/api/sales/enablement-sessions/${encodeURIComponent(sessionId)}/participants/add`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ commandId, person }) });
      const result = await readJsonObject(response);
      if (registrationGeneration.current !== generation) return;
      const durableCommandId = textField(result, "commandId");
      if (durableCommandId) registrationCommand.current = { key, commandId: durableCommandId };
      if (!response.ok) {
        const code = textField(result, "code"); const correlationId = textField(result, "correlationId");
        const recovery = classifyParticipantAddRecovery({ code: code ?? undefined, dispatchOutcome: textField(result, "dispatchOutcome") ?? undefined });
        if (recovery === "quick_retry") {
          const delays = automaticRetryMode.current === "quick" ? participantAddRecovery.oauthRetryDelaysMs : participantAddRecovery.reconciledRetryDelaysMs;
          const delayMs = delays[automaticRetryCount.current];
          if (delayMs !== undefined) {
            automaticRetryCount.current += 1;
            const nextRetryAt = new Date(Date.now() + delayMs).toISOString();
            setRegistrationOutcome({ retryable: true, correlationId: correlationId ?? null, nextRetryAt, nextAction: "retry" });
            automaticRetryTimer.current = setTimeout(() => { automaticRetryTimer.current = null; if (registrationGeneration.current === generation) void registerSelected(true, person); }, delayMs);
            throw new Error(`CloudShare failed before any participant write. Automatic ${automaticRetryMode.current === "quick" ? "OAuth" : "recovered add"} retry ${automaticRetryCount.current} of ${delays.length} is scheduled for ${nextRetryAt}.`);
          }
          setRegistrationOutcome({ retryable: true, correlationId: correlationId ?? null });
          throw new Error("Automatic participant-add recovery is exhausted. Manual retry remains safe; open Support diagnostics if it fails again.");
        }
        if (recovery === "reconcile_only") {
          const delayMs = participantAddRecovery.ambiguousReconciliationDelayMs;
          const nextRetryAt = new Date(Date.now() + delayMs).toISOString();
          setRegistrationOutcome({ retryable: false, correlationId: correlationId ?? null, nextRetryAt, nextAction: "reconcile" });
          automaticRetryTimer.current = setTimeout(() => { automaticRetryTimer.current = null; if (registrationGeneration.current === generation) void refreshRegistrationEvidence(true, person); }, delayMs);
          throw new Error(`CloudShare may have received the participant write. It will not be replayed. A read-only status check is scheduled for ${nextRetryAt}.`);
        }
        setRegistrationOutcome({ retryable: false, correlationId: correlationId ?? null });
        throw new Error(textField(result, "error") ?? `Registration failed (${response.status}).`);
      }
      automaticRetryCount.current = 0;
      registrationCommand.current = null;
      setRegistrationId(""); setAdHoc({ firstName: "", lastName: "", email: "" }); setRegistrationFeedback(textField(result, "outcome") === "already_registered" ? "Participant was already registered. No CloudShare invitation was sent." : "Participant registered. No CloudShare invitation was sent.");
      if (query || offset) { historyMode.current = "push"; setQuery(""); setOffset(0); }
      await rereadWorkspace();
    } catch (cause) { if (registrationGeneration.current === generation) setRegistrationFeedback(cause instanceof Error ? cause.message : "Registration failed; retry or open Support."); }
    finally { if (registrationGeneration.current === generation) setRegistrationBusy(false); }
  };
  const refreshRegistrationEvidence = async (automatic = false, person?: ParticipantAddPerson) => {
    if (registrationBusy || !registrationCommand.current) return;
    const generation = registrationGeneration.current;
    setRegistrationBusy(true);
    setRegistrationFeedback("Checking CloudShare participant status…");
    try {
      const response = await request(`/api/sales/enablement-sessions/${encodeURIComponent(sessionId)}/participants/add/reconcile`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ commandId: registrationCommand.current.commandId }) });
      const result = await readJsonObject(response); const code = textField(result, "code"); const correlationId = textField(result, "correlationId");
      if (registrationGeneration.current !== generation) return;
      const retryable = code === "participant_add_retryable" && result?.dispatchOutcome === "not_dispatched";
      if (retryable && automatic && person) {
        automaticRetryMode.current = "reconciled"; automaticRetryCount.current = 0;
        const delayMs = participantAddRecovery.reconciledRetryDelaysMs[0]; const nextRetryAt = new Date(Date.now() + delayMs).toISOString();
        automaticRetryCount.current = 1;
        setRegistrationOutcome({ retryable: true, correlationId: correlationId ?? registrationOutcome?.correlationId ?? null, nextRetryAt, nextAction: "retry" });
        automaticRetryTimer.current = setTimeout(() => { automaticRetryTimer.current = null; if (registrationGeneration.current === generation) void registerSelected(true, person); }, delayMs);
        setRegistrationFeedback(`CloudShare absence and pre-dispatch evidence agree. Recovered add retry 1 of 4 is scheduled for ${nextRetryAt}.`);
      } else {
        setRegistrationOutcome({ retryable, correlationId: correlationId ?? registrationOutcome?.correlationId ?? null });
        setRegistrationFeedback(retryable ? "CloudShare absence and pre-dispatch evidence agree. Manual retry is safe." : "Do not retry: CloudShare may have received the participant write.");
      }
      await rereadWorkspace();
    } catch { if (registrationGeneration.current === generation) setRegistrationFeedback("CloudShare status check failed. Do not retry; open Support diagnostics."); }
    finally { if (registrationGeneration.current === generation) setRegistrationBusy(false); }
  };
  const cancelScheduledRecovery = () => {
    if (automaticRetryTimer.current) { clearTimeout(automaticRetryTimer.current); automaticRetryTimer.current = null; }
  };
  const retryParticipantNow = () => { cancelScheduledRecovery(); void registerSelected(true); };
  const reconcileParticipantNow = () => { cancelScheduledRecovery(); void refreshRegistrationEvidence(); };

  const runAction = async (participant: SalesParticipantWorkspaceRow, action: Action) => {
    if (props.cancelled && action !== "revoke_launch") { setFeedback(current => ({ ...current, [participant.id]: "Session cancelled. Access and invitations are unavailable." })); return; }
    if (action === "revoke_launch") { logicalFocus.current = "inspector"; originRef.current = document.activeElement as HTMLElement; setRevokeTarget(participant); return; }
    setFeedback((current) => ({ ...current, [participant.id]: "Working…" }));
    try {
      const invite = action === "invite" || action === "resend";
      const url = invite ? `/api/sales/enablement-sessions/${encodeURIComponent(sessionId)}/participants/invite` : `/api/sales/enablement-sessions/${encodeURIComponent(sessionId)}/participants/${encodeURIComponent(participant.id)}/launch-link`;
      const body = invite ? JSON.stringify({ commandId: crypto.randomUUID(), targets: [{ participantId: participant.id, intent: action, expectedInvitationStatus: participant.invitationStatus, participantRevision: participant.participantRevision }] }) : undefined;
      const response = await request(url, { method: "POST", headers: body ? { "Content-Type": "application/json" } : undefined, body });
      const result = await readJsonObject(response);
      const code = textField(result, "code");
      const outcome = textField(result, "outcome");
      const correlationId = textField(result, "correlationId");
      const launchUrl = textField(result, "launchUrl");
      if (!response.ok) {
        const competingFence = code === "invitation_blocked" || code === "precondition_failed" || code === "command_id_mismatch";
        throw new Error(code === "no_replay"
          ? "No replay permitted: provider outcome is ambiguous; open Support."
          : competingFence
            ? "Another invitation command is already in progress or awaiting confirmation. Refresh Participant state before starting another invitation action."
            : textField(result, "error") ?? `Action failed (${response.status}).`);
      }
      let copiedLaunch = false;
      if (launchUrl) {
        const launch = new URL(launchUrl, window.location.origin);
        if (launch.origin !== window.location.origin || !launch.pathname.startsWith("/sales/launch/")) throw new Error("Launch link was rejected because it was not a Certalis portal link.");
        if (navigator.clipboard?.writeText) {
          try {
            await navigator.clipboard.writeText(launch.toString());
            copiedLaunch = true;
          } catch {
            // The capability remains generated locally when browser clipboard
            // permission is unavailable; never follow it as a fallback.
          }
        }
        setGeneratedLaunch(copiedLaunch ? null : { sessionId, participantId: participant.id, url: launch.toString() });
      }
      const confirmationPending = response.status === 202 || code === "confirmation_required" || outcome === "confirmation_required" || outcome === "in_progress";
      const message = confirmationPending ? `Confirmation pending; the replay fence is retained.${correlationId ? ` Correlation ${correlationId}.` : ""}` : outcome === "completed_with_unconfirmed" || outcome === "accepted_unconfirmed" ? `CloudShare acknowledged the invitation; delivery remains unconfirmed. The same command will not run again. The fence is released; an administrator may start a new Resend.${correlationId ? ` Correlation ${correlationId}.` : ""}` : outcome === "failed_retryable" ? "Action failed temporarily; retry is available." : launchUrl ? copiedLaunch ? "Launch link generated and copied." : "Launch link generated. Copy it from the local workspace when clipboard access is available." : correlationId ? `Completed. Correlation ${correlationId}.` : "Completed.";
      setFeedback((current) => ({ ...current, [participant.id]: message }));
    } catch (cause) {
      setFeedback((current) => ({ ...current, [participant.id]: cause instanceof Error ? cause.message : "Action failed; retry or open Support." }));
    } finally {
      await rereadWorkspace();
    }
  };
  const confirmRevoke = async () => {
    if (!revokeTarget) return;
    const target = revokeTarget;
    setRevokeTarget(null);
    try {
      const response = await request(`/api/sales/enablement-sessions/${encodeURIComponent(sessionId)}/participants/${encodeURIComponent(target.id)}/launch-link`, { method: "DELETE" });
      const result = await readJsonObject(response);
      const correlationId = textField(result, "correlationId");
      const correlation = correlationId ? ` Correlation ${correlationId}.` : "";
      setFeedback((current) => ({ ...current, [target.id]: response.ok ? `Launch link revoked.${correlation}` : `${textField(result, "error") ?? `Revoke failed (${response.status}); retry or open Support.`}${correlation}` }));
    } catch {
      setFeedback((current) => ({ ...current, [target.id]: "Revoke failed; retry or open Support." }));
    } finally {
      await rereadWorkspace();
      setFocusAfterReread(target.id);
    }
  };
  return <>
    <section className={styles.panel}>
      <div className={styles.panelHeading}><div><h2 ref={headingRef} tabIndex={-1}>Participants</h2><p>Bounded Participant workspace page.</p></div><span className={styles.count}>{page?.total ?? 0} participants · {selection.selectedIds.length} selected</span></div>
      <label htmlFor="participant-query">Search Participants</label>
      <input id="participant-query" value={query} onChange={(event) => { historyMode.current = "push"; setQuery(event.target.value); setOffset(0); }} placeholder="Search name or email" />
      {feedback._announcement ? <p role="alert" aria-live="polite">{feedback._announcement}</p> : null}
      {page && !props.cancelled ? <div className={styles.empty}><strong>Add Participant</strong><p>Registration does not send a CloudShare invitation.</p><label><input type="radio" checked={addMode === "existingContact"} disabled={registrationBusy} onChange={() => { startNewRegistrationTarget(); setAddMode("existingContact"); }} /> Existing Opportunity Contact</label>{addMode === "existingContact" ? <><select aria-label="Eligible Opportunity Contact" disabled={registrationBusy || !page.eligibleContacts?.length} value={registrationId} onChange={(event) => { startNewRegistrationTarget(); setRegistrationId(event.target.value); }}><option value="">{page.eligibleContacts?.length ? "Select a Contact" : "No eligible Contacts"}</option>{page.eligibleContacts?.map((contact) => <option key={contact.id} value={contact.id}>{contact.name} · {contact.email}</option>)}</select></> : null}<label><input type="radio" checked={addMode === "adHoc"} disabled={registrationBusy} onChange={() => { startNewRegistrationTarget(); setAddMode("adHoc"); }} /> New person</label>{addMode === "adHoc" ? <><input aria-label="First name" placeholder="First name" disabled={registrationBusy} value={adHoc.firstName} onChange={(event) => { startNewRegistrationTarget(); setAdHoc({ ...adHoc, firstName: event.target.value }); }} /><input aria-label="Last name" placeholder="Last name" disabled={registrationBusy} value={adHoc.lastName} onChange={(event) => { startNewRegistrationTarget(); setAdHoc({ ...adHoc, lastName: event.target.value }); }} /><input aria-label="Email" type="email" placeholder="Email" disabled={registrationBusy} value={adHoc.email} onChange={(event) => { startNewRegistrationTarget(); setAdHoc({ ...adHoc, email: event.target.value }); }} /></> : null}<button type="button" disabled={registrationBusy || registrationOutcome !== null || (addMode === "existingContact" ? !registrationId : !adHoc.firstName.trim() || !adHoc.lastName.trim() || !adHoc.email.trim())} onClick={() => void registerSelected()}>Add participant</button>{registrationFeedback ? <p role="status">{registrationFeedback}</p> : null}{registrationOutcome ? <p>Correlation ID: <code>{registrationOutcome.correlationId ?? "unavailable"}</code> · <a href={`/sales?tab=support${registrationOutcome.correlationId ? `&correlationId=${encodeURIComponent(registrationOutcome.correlationId)}` : ""}`}>Support diagnostics</a>{registrationOutcome.retryable ? <button type="button" onClick={retryParticipantNow}>{registrationOutcome.nextAction === "retry" ? "Retry participant add now" : "Retry participant add"}</button> : <button type="button" onClick={reconcileParticipantNow}>{registrationOutcome.nextAction === "reconcile" ? "Check CloudShare status now" : "Check CloudShare status"}</button>}</p> : null}</div> : null}
      {active && page && !props.cancelled ? <SalesParticipantExtension key={sessionId} sessionId={sessionId} rows={page.participants} request={request} onRefreshed={rereadWorkspace} onAccessConfirmed={props.onAccessConfirmed} /> : null}
      {loadFailed ? null : page?.participants.length ? <div className={styles.tableWrap} role="region" aria-label="Scrollable Participant roster" tabIndex={0}><table aria-label="Participant roster" className={styles.roster}><thead><tr><th>Participant</th><th>Invitation</th><th>Participation</th><th>Participant Environment</th><th>Environment source</th></tr></thead><tbody>{page.participants.map((participant) => { const selected = selection.selectedIds.includes(participant.id); const current = selection.activeId === participant.id; const pageIds = page.participants.map((row) => row.id); return <React.Fragment key={participant.id}><tr aria-selected={selected} data-participant-id={participant.id} data-active={current ? "true" : undefined} data-selected={selected ? "true" : undefined} tabIndex={current ? 0 : -1} onClick={(event) => { if ((event.target as HTMLElement).closest("button,a,input,select,textarea")) return; clearedInspectorTarget.current = false; historyMode.current = "push"; setSelection((state) => reduceParticipantSelection(state, { type: "click", id: participant.id, additive: event.ctrlKey || event.metaKey, range: event.shiftKey, pageIds })); }} onKeyDown={(event) => { if ((event.target as HTMLElement).closest("button,a,input,select,textarea")) return; clearedInspectorTarget.current = false; historyMode.current = "push"; if (event.key === "ArrowDown" || event.key === "ArrowUp") { event.preventDefault(); setSelection((state) => reduceParticipantSelection(state, { type: "move", direction: event.key === "ArrowDown" ? "next" : "previous", pageIds })); } else if (event.key === " ") { event.preventDefault(); setSelection((state) => reduceParticipantSelection(state, { type: "toggle", id: participant.id, range: event.shiftKey, pageIds })); } else if (event.key === "Enter") { event.preventDefault(); openInspector(participant.id, event.currentTarget); } }}><th scope="row"><strong>{participant.name}</strong><span>{participant.email}</span><button type="button" aria-expanded={current && inspectorOpen} onClick={(event) => current && inspectorOpen ? closeInspector() : openInspector(participant.id, event.currentTarget)}>{current && inspectorOpen ? "Close" : "Inspect"}</button></th><td><span className={styles.inlineBadge}>{participant.invitationStatus === "sent" ? "Sent" : "Not sent"}</span></td><td><span className={styles.inlineBadge}>{participant.sessionCancelled ? "Access blocked" : participant.participationStatus === "inProgress" ? "In progress" : participant.participationStatus === "concluded" ? "Concluded" : "Pending"}</span></td><td>{participant.environment.value ?? "Not observed"}</td><td>{humanEnvironmentSource(participant.environment)}</td></tr>{current && inspectorOpen && activeParticipant ? <tr><td colSpan={5}>{<ParticipantInspector participant={activeParticipant} sessionId={sessionId} inspectorRef={inspectorRef} feedback={feedback[activeParticipant.id]} generatedLaunchUrl={generatedLaunch?.participantId === activeParticipant.id && generatedLaunch.sessionId === sessionId ? generatedLaunch.url : null} onClose={closeInspector} onAction={runAction} />}</td></tr> : null}</React.Fragment>; })}</tbody></table></div> : page && page.total === 0 && !query && offset === 0 ? <div className={styles.empty}><p>No Participants are registered for this Sales Session.</p></div> : <p className={styles.empty}>No Participants match this page or search.</p>}
      {offset > 0 ? <button type="button" onClick={() => { historyMode.current = "push"; setOffset(Math.max(0, offset - 25)); }}>Previous</button> : null}{page?.hasMore ? <button type="button" onClick={() => { historyMode.current = "push"; setOffset(offset + 25); }}>Next</button> : null}
    </section>
    {revokeTarget ? <div role="dialog" aria-modal="true" aria-label="Confirm revoke launch link" className={styles.panel} onKeyDown={(event) => { if (event.key === "Escape") { event.preventDefault(); setRevokeTarget(null); queueMicrotask(() => originRef.current?.focus()); } if (event.key === "Tab") { const buttons = Array.from(event.currentTarget.querySelectorAll("button")); const index = buttons.indexOf(document.activeElement as HTMLButtonElement); const next = buttons[(index + (event.shiftKey ? -1 : 1) + buttons.length) % buttons.length]; event.preventDefault(); next?.focus(); } }}><p>Revoke the launch link for {revokeTarget.name}?</p><button autoFocus type="button" onClick={() => void confirmRevoke()}>Revoke</button><button type="button" onClick={() => { setRevokeTarget(null); queueMicrotask(() => originRef.current?.focus()); }}>Cancel</button></div> : null}
  </>;
}

function ParticipantInspector({ participant, sessionId, inspectorRef, feedback, generatedLaunchUrl, onClose, onAction }: { participant: SalesParticipantWorkspaceRow; sessionId: string; inspectorRef: React.RefObject<HTMLElement | null>; feedback?: string; generatedLaunchUrl: string | null; onClose: () => void; onAction: (participant: SalesParticipantWorkspaceRow, action: Action) => Promise<void> }) {
  const primary = participant.primaryAction;
  const activityCorrelation = participant.invitationCorrelationId ?? participant.latestInvitationCorrelationId ?? participant.launchOperation?.correlationId ?? null;
  return <aside ref={inspectorRef} tabIndex={-1} className={styles.panel} aria-label="Participant inspector" onKeyDown={(event) => { if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); onClose(); } }}><div className={styles.panelHeading}><div><h2>Participant inspector</h2><p>{participant.name} · {participant.email}</p></div></div><p>Invitation: <strong>{participant.invitationStatus}</strong> · Participation: <strong>{participant.participationStatus}</strong></p><p>Environment state: <strong>{participant.environment.value ?? "Not observed"}</strong></p><p>Environment source: <strong>{humanEnvironmentSource(participant.environment)}</strong></p><p>Session access ends: <time dateTime={participant.sessionEndsAt}>{explicitUtcTime(participant.sessionEndsAt)}</time></p>{durableFeedback(participant) ? <p role="status" aria-live="polite">{durableFeedback(participant)}</p> : null}<div role="group" aria-label="Participant actions" className={styles.inspectorActions}>{(["invite", "resend", "generate_launch", "revoke_launch"] as const).map((action) => { const availability = participant.actionAvailability[action]; const reason = availability.available ? null : actionReasonMessage(availability.reason); const reasonId = `participant-${participant.id}-${action}-reason`; return <React.Fragment key={action}><button type="button" style={primary === action ? primaryButtonStyle : secondaryButtonStyle} data-primary-action={primary === action ? "true" : undefined} disabled={!availability.available} aria-describedby={reason ? reasonId : undefined} onClick={() => void onAction(participant, action)}>{action === "generate_launch" ? "Generate launch link" : action === "revoke_launch" ? "Revoke launch link" : action[0].toUpperCase() + action.slice(1)}</button>{reason ? <span id={reasonId}>{reason}</span> : null}</React.Fragment>; })}</div>{feedback ? <p role="status" aria-live="polite">{feedback}</p> : null}{generatedLaunchUrl ? <label>Generated launch link<input aria-label="Generated launch link" readOnly value={generatedLaunchUrl} /></label> : null}<p><a href={`/sales/sessions/${encodeURIComponent(sessionId)}?area=activity${activityCorrelation ? `&correlationId=${encodeURIComponent(activityCorrelation)}` : ""}`}>View Activity</a> · <a style={primary === "open_diagnostics" ? primaryButtonStyle : undefined} data-primary-action={primary === "open_diagnostics" ? "true" : undefined} href="/sales?tab=support">Open Support</a></p></aside>;
}

function actionReasonMessage(reason: SalesParticipantWorkspaceRow["actionAvailability"][Action]["reason"]): string {
  return reason === "participant_concluded" ? "Participant has concluded."
    : reason === "session_cancelled" ? "Session cancelled."
    : reason === "session_ended" ? "Session access window has ended."
    : reason === "invitation_already_sent" ? "Invitation already sent; choose resend."
    : reason === "invitation_not_sent" ? "Send an invitation before attempting a resend."
    : reason === "invitation_command_pending" ? "An invitation command is already in progress or awaiting confirmation."
    : reason === "participant_correlation_unavailable" ? "Participant correlation is unavailable."
    : reason === "native_invitations_unavailable" ? "Native invitations are unavailable."
    : reason === "no_active_launch" ? "There is no active launch link to revoke."
    : "Action is unavailable for the current Participant state.";
}

async function readJsonObject(response: Response): Promise<Record<string, unknown>> {
  try {
    const value: unknown = await response.json();
    if (value === null || typeof value !== "object" || Array.isArray(value)) return {};
    return value as Record<string, unknown>;
  } catch {
    return {};
  }
}

function textField(value: Record<string, unknown>, key: string): string | undefined {
  return typeof value[key] === "string" ? value[key] : undefined;
}

function safelyFocusable(value: HTMLElement | null | undefined): value is HTMLElement {
  return Boolean(value?.isConnected)
    && !(value instanceof HTMLButtonElement && value.disabled)
    && value?.getAttribute("aria-disabled") !== "true";
}

function explicitUtcTime(value: string): string {
  if (!/(?:Z|[+-]\d{2}:\d{2})$/i.test(value)) return "Invalid time";
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? "Invalid time" : parsed.toISOString();
}
function durableFeedback(participant: SalesParticipantWorkspaceRow): string | null {
  const invitationOutcome = participant.invitationOutcome ?? participant.latestInvitationOutcome;
  const invitationReason = participant.invitationReason ?? participant.latestInvitationReason;
  const invitationCorrelation = participant.invitationCorrelationId ?? participant.latestInvitationCorrelationId;
  const invitation = invitationOutcome
    ? `${invitationOutcomeCopy[invitationOutcome]}${invitationReason ? ` ${invitationReasonCopy[invitationReason]}` : ""}${invitationCorrelation ? ` Correlation ${invitationCorrelation}.` : ""}`
    : null;
  const launch = participant.launchOperation
    ? `${launchOperationCopy[participant.launchOperation.operation]} ${launchOutcomeCopy[participant.launchOperation.outcome]}${participant.launchOperation.reason ? ` ${launchReasonCopy[participant.launchOperation.reason]}` : ""}${participant.launchOperation.correlationId ? ` Correlation ${participant.launchOperation.correlationId}.` : ""}`
    : null;
  return [invitation, launch].filter(Boolean).join(" ") || null;
}

const invitationOutcomeCopy: Record<InvitationOutcome, string> = {
  confirmed: "CloudShare confirmed the invitation.",
  confirmed_by_reconciliation: "Certalis confirmed the invitation during a CloudShare roster check.",
  accepted_unconfirmed: "CloudShare acknowledged the invitation; delivery remains unconfirmed. The same command will not run again. The fence is released; an administrator may start a new Resend.",
  confirmation_required: "CloudShare delivery could not be confirmed. The same command will not run again while its confirmation fence remains in place.",
  no_replay: "The provider result is ambiguous. The same command will not run again; open Support before starting another invitation action.",
  failed_retryable: "The invitation action failed without an ambiguous provider result. The same command will not run again.",
};
const invitationReasonCopy: Record<InvitationSafeReason, string> = {
  not_dispatched: "The invitation request did not reach CloudShare.",
  provider_rejected: "CloudShare rejected the invitation request.",
  ambiguous_after_dispatch: "CloudShare may have received the request; Support must review it before another invitation action starts.",
  confirmation_required: "The confirmation fence remains in place.",
  failed_retryable: "A newly initiated invitation action may be attempted.",
  stale_revision: "The Participant changed before the invitation action could start.",
  blocked_by_fence: "Another invitation command is already in progress or awaiting confirmation.",
};
const launchOperationCopy: Record<SalesParticipantLaunchOperationKind, string> = {
  generate: "Launch link generation",
  revoke: "Launch link revocation",
};
const launchOutcomeCopy: Record<SalesParticipantLaunchOutcome, string> = {
  success: "succeeded.",
  failure: "failed.",
};
const launchReasonCopy: Record<"persistence_failure", string> = {
  persistence_failure: "Certalis could not save the launch operation.",
};

function humanEnvironmentSource(environment: SalesParticipantWorkspaceRow["environment"]): string {
  if (environment.source === "confirmed_session_cancellation") return `Cancellation confirmation saved ${explicitUtcTime(environment.confirmedAt)}`;
  const value = environment.source;
  if ((value === "cloudshare_v3_environment" || value === "cloudshare_v4_environment")) return "Observed from CloudShare Environment";
  if (value === "cloudshare_v4_sales_participant_roster") return "Observed from CloudShare participant roster";
  if (value === "not_assigned") return "No CloudShare Environment is assigned";
  return "CloudShare Environment state has not been observed";
}
