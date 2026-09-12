"use client";
import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useRouter } from "next/navigation";
import { createAdminAuthenticatedRequest } from "./admin-authenticated-request";
import { createPortalSessionExpiryRedirect } from "./portal-session-redirect";
import { useContext } from "react";
import { SalesWorkspaceExpiryContext } from "./sales-workspace-chrome";
import { statusBadgeStyle } from "./status-badge";
import styles from "./sales-session-workspace.module.css";
import {
  projectSalesParticipantBrowserActionResult,
  type SalesSessionWorkspaceResponse,
} from "@/domain/sales-session-workspace";
import type { SalesSessionVerifyResponse } from "@/api/sales-session-reconciliation";
import {
  focusParticipantRow,
  reduceParticipantRowInteraction,
  reconcileParticipantRowInteraction,
  type ParticipantRowInteraction,
} from "@/domain/sales-participant-row-interaction";
import { createSalesParticipantRosterReader } from "@/domain/sales-participant-roster-reader";
import { createSalesParticipantOperationCoordinator } from "@/domain/sales-participant-operation-coordinator";

type Area = "participants" | "activity" | "details";
type DiagnosticRecord = {
  readonly correlationId: string;
  readonly occurredAt: string;
};

export function SalesSessionWorkspace(props: {
  readonly sessionId: string;
  readonly area: Area;
  readonly queueHref: string;
}) {
  return <SalesSessionWorkspaceState key={props.sessionId} {...props} />;
}

function SalesSessionWorkspaceState({
  sessionId,
  area,
  queueHref,
}: {
  readonly sessionId: string;
  readonly area: Area;
  readonly queueHref: string;
}) {
  const router = useRouter();
  const [workspace, setWorkspace] =
    useState<SalesSessionWorkspaceResponse | null>(null);
  const lastSafeWorkspaceRef = useRef<SalesSessionWorkspaceResponse | null>(
    null,
  );
  const [error, setError] = useState<string | null>(null);
  const [sessionExpired, setSessionExpired] = useState(false);
  const [verification, setVerification] = useState<string | null>(null);
  const [verificationCorrelationId, setVerificationCorrelationId] = useState<
    string | null
  >(null);
  const [refreshCorrelationId, setRefreshCorrelationId] = useState<
    string | null
  >(null);
  const attemptedRefresh = useRef<string | null>(null);
  const [verifying, setVerifying] = useState(false);
  const [automaticRefresh, setAutomaticRefresh] = useState<string | null>(null);
  const [refreshOutcome, setRefreshOutcome] = useState<
    "idle" | "pending" | "success" | "failure"
  >("idle");
  const [refreshBusy, setRefreshBusy] = useState(false);
  const [workspaceRetry, setWorkspaceRetry] = useState(0);
  const [participantQuery, setParticipantQuery] = useState(() =>
    typeof window === "undefined"
      ? ""
      : (new URLSearchParams(window.location.search).get("participantQuery") ??
        ""),
  );
  const [participantPage, setParticipantPage] = useState(() =>
    typeof window === "undefined"
      ? 0
      : Number(
          new URLSearchParams(window.location.search).get("participantPage") ??
            "0",
        ) || 0,
  );
  const [activeParticipantId, setActiveParticipantId] = useState<string | null>(
    null,
  );
  const [selectedParticipantIds, setSelectedParticipantIds] = useState<
    Set<string>
  >(new Set());
  const rowInteraction = useRef<ParticipantRowInteraction>({
    activeId: null,
    selectedIds: new Set(),
    anchorId: null,
    focus: "row",
  });
  const [participantFeedback, setParticipantFeedback] = useState<
    Record<
      string,
      {
        message: string;
        correlationId?: string;
        launchUrl?: string;
        ok: boolean;
      }
    >
  >({});
  const [revokeOpen, setRevokeOpen] = useState(false);
  const revokeConfirmRef = useRef<HTMLButtonElement>(null);
  const revokeTriggerRef = useRef<HTMLButtonElement>(null);
  const originRow = useRef<string | null>(null);
  const selectionAnchor = useRef<string | null>(null);
  const inspectorRef = useRef<HTMLElement>(null);
  const requestInFlight = useRef(false);
  const lifecycle = useRef({ active: false, token: 0 });
  const shellExpiry = useContext(SalesWorkspaceExpiryContext);
  const areaHeading = useRef<HTMLHeadingElement>(null);
  const fallbackExpiry = useMemo(
    () =>
      createPortalSessionExpiryRedirect({
        currentPath: () =>
          `${window.location.pathname}${window.location.search}`,
        fallbackLoginPath: "/login",
        replace: (path) => {
          setSessionExpired(true);
          router.replace(path);
        },
      }),
    [router],
  );
  const authenticatedRequest = useCallback(
    (token: number) =>
      createAdminAuthenticatedRequest({
        fetchImpl: window.fetch.bind(window),
        onSessionExpired: () => {
          if (lifecycle.current.active && lifecycle.current.token === token)
            (shellExpiry ?? fallbackExpiry)();
        },
      }),
    [fallbackExpiry, shellExpiry],
  );
  const handleSessionExpired = () => {
    if (lifecycle.current.active) (shellExpiry ?? fallbackExpiry)();
  };
  useEffect(() => {
    const onPopState = () => {
      const params = new URLSearchParams(window.location.search);
      const query = params.get("participantQuery") ?? "";
      previousParticipantQuery.current = query;
      setParticipantQuery(query);
      setParticipantPage(Number(params.get("participantPage") ?? "0") || 0);
    };
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, []);
  useEffect(() => {
    const url = new URL(window.location.href);
    if (participantQuery.trim())
      url.searchParams.set("participantQuery", participantQuery.trim());
    else url.searchParams.delete("participantQuery");
    if (participantPage)
      url.searchParams.set("participantPage", String(participantPage));
    else url.searchParams.delete("participantPage");
    window.history.replaceState(null, "", url);
  }, [participantPage, participantQuery]);
  const previousParticipantQuery = useRef(participantQuery);
  useEffect(() => {
    if (previousParticipantQuery.current !== participantQuery) {
      previousParticipantQuery.current = participantQuery;
      setParticipantPage(0);
    }
  }, [participantQuery]);
  useEffect(() => {
    const owner = lifecycle.current;
    owner.active = true;
    owner.token += 1;
    return () => {
      owner.active = false;
    };
  }, []);
  const rosterReader = useMemo(
    () =>
      createSalesParticipantRosterReader<SalesSessionWorkspaceResponse>({
        fetch: (url, init) =>
          authenticatedRequest(lifecycle.current.token)(url, init),
      route: (id) => `/api/sales/enablement-sessions/${id}/workspace`,
        decode: async (response) =>
          (await response.json()) as SalesSessionWorkspaceResponse,
      }),
    [authenticatedRequest],
  );
  useEffect(() => {
    const token = ++lifecycle.current.token;
    const abort = new AbortController();
    void rosterReader
      .read({
        sessionId,
        query: participantQuery,
        page: participantPage,
        pageSize: 25,
        signal: abort.signal,
      })
      .then((result) => {
        if (
          !lifecycle.current.active ||
          lifecycle.current.token !== token ||
          (!result.ok && result.error === "Superseded roster read.")
        )
          return;
        if (result.ok) {
          setWorkspace(result.data);
          lastSafeWorkspaceRef.current = result.data;
          setError(null);
        } else {
          setError(result.error);
          if (result.lastSafe) setWorkspace(result.lastSafe);
        }
      });
    return () => abort.abort();
  }, [
    rosterReader,
    sessionId,
    participantQuery,
    participantPage,
    workspaceRetry,
  ]);
  useEffect(() => {
    if (
      area === "activity" ||
      !workspace ||
      workspace.summary.experience.freshness === "fresh" ||
      requestInFlight.current
    )
      return;
    const snapshot = `${workspace.summary.id}:${workspace.summary.experience.source}:${workspace.summary.experience.freshness}:${workspace.summary.experience.observedAt ?? ""}`;
    if (attemptedRefresh.current === snapshot) return;
    attemptedRefresh.current = snapshot;
    const token = lifecycle.current.token;
    requestInFlight.current = true;
    setRefreshBusy(true);
    setRefreshOutcome("pending");
    setAutomaticRefresh("Checking the latest CloudShare status…");
    const request = authenticatedRequest(token);
    void request(
      `/api/sales/enablement-sessions/refresh?mode=automatic&targetId=${encodeURIComponent(sessionId)}&limit=1`,
      { method: "POST" },
    )
      .then(async (response) => {
        const body = (await response.json()) as {
          error?: string;
          correlationId?: string;
        };
        if (!response.ok) {
          if (
            body.correlationId &&
            lifecycle.current.active &&
            lifecycle.current.token === token
          )
            setRefreshCorrelationId(body.correlationId);
          throw new Error(
            body.error ??
              "Automatic refresh failed. Retry or open Sales support.",
          );
        }
        const reread = await request(
          `/api/sales/enablement-sessions/${encodeURIComponent(sessionId)}/workspace`,
          { cache: "no-store" },
        );
        const next = (await reread.json()) as SalesSessionWorkspaceResponse & {
          error?: string;
        };
        if (!reread.ok)
          throw new Error(
            next.error ?? "The refreshed Sales Session could not be read.",
          );
        if (lifecycle.current.active && lifecycle.current.token === token) {
          setWorkspace(next);
          if (next.summary.experience.freshness !== "fresh") {
            setRefreshOutcome("failure");
            setAutomaticRefresh(
              "CloudShare returned no fresh observation. Retry or open Sales support.",
            );
          } else {
            setRefreshOutcome("success");
            setAutomaticRefresh("CloudShare status refreshed.");
          }
        }
      })
      .catch((cause) => {
        if (lifecycle.current.active && lifecycle.current.token === token) {
          setRefreshOutcome("failure");
          setAutomaticRefresh(
            cause instanceof Error
              ? cause.message
              : "Automatic refresh failed. Retry or open Sales support.",
          );
        }
      })
      .finally(() => {
        if (lifecycle.current.active && lifecycle.current.token === token) {
          requestInFlight.current = false;
          setRefreshBusy(false);
        }
      });
  }, [area, authenticatedRequest, sessionId, workspace]);
  useEffect(() => {
    areaHeading.current?.focus();
  }, [area, workspace?.summary.id]);
  const activity = (workspace?.activityGroups ?? []).map((group) => ({
    ...group,
    steps: group.steps ?? [],
  }));
  const retryAutomaticRefresh = async () => {
    if (requestInFlight.current) return;
    requestInFlight.current = true;
    const token = lifecycle.current.token;
    setRefreshCorrelationId(null);
    setRefreshBusy(true);
    setRefreshOutcome("pending");
    setAutomaticRefresh("Retrying CloudShare status…");
    const request = authenticatedRequest(token);
    try {
      const response = await request(
        `/api/sales/enablement-sessions/refresh?mode=automatic&targetId=${encodeURIComponent(sessionId)}&limit=1`,
        { method: "POST" },
      );
      const body = (await response.json()) as {
        error?: string;
        correlationId?: string;
      };
      if (
        body.correlationId &&
        lifecycle.current.active &&
        lifecycle.current.token === token
      )
        setRefreshCorrelationId(body.correlationId);
      if (!response.ok)
        throw new Error(
          body.error ??
            "Automatic refresh failed. Retry or open Sales support.",
        );
      const reread = await request(
        `/api/sales/enablement-sessions/${encodeURIComponent(sessionId)}/workspace`,
        { cache: "no-store" },
      );
      const next = (await reread.json()) as SalesSessionWorkspaceResponse & {
        error?: string;
      };
      if (!reread.ok)
        throw new Error(
          next.error ?? "The refreshed Sales Session could not be read.",
        );
      if (lifecycle.current.active && lifecycle.current.token === token) {
        setWorkspace(next);
        if (next.summary.experience.freshness !== "fresh") {
          setRefreshOutcome("failure");
          setAutomaticRefresh("CloudShare returned no fresh observation.");
        } else {
          setRefreshOutcome("success");
          setAutomaticRefresh("CloudShare status refreshed.");
        }
      }
    } catch (cause) {
      if (lifecycle.current.active && lifecycle.current.token === token) {
        setRefreshOutcome("failure");
        setAutomaticRefresh(
          cause instanceof Error
            ? cause.message
            : "Automatic refresh failed. Retry or open Sales support.",
        );
      }
    } finally {
      if (lifecycle.current.active && lifecycle.current.token === token) {
        requestInFlight.current = false;
        setRefreshBusy(false);
      }
    }
  };
  useEffect(() => {
    if (revokeOpen) revokeConfirmRef.current?.focus();
  }, [revokeOpen]);
  useEffect(() => {
    const restoreOrigin = (event: KeyboardEvent) => {
      if (
        event.key !== "Escape" ||
        !inspectorRef.current?.contains(document.activeElement)
      )
        return;
      event.preventDefault();
      requestAnimationFrame(() =>
        document
          .getElementById(`participant-${originRow.current ?? ""}`)
          ?.focus(),
      );
    };
    document.addEventListener("keydown", restoreOrigin, true);
    return () => document.removeEventListener("keydown", restoreOrigin, true);
  }, []);
  if (sessionExpired)
    return (
      <main aria-live="polite">
        <p>Your session has expired. Sign in again to continue.</p>
      </main>
    );
  if (error && !workspace)
    return (
      <section role="alert" className={styles.error}>
        <h1>Sales Session unavailable</h1>
        <p>{error}</p>
        <button
          type="button"
          onClick={() => {
            setError(null);
            setWorkspaceRetry((value) => value + 1);
          }}
        >
          Retry
        </button>
        <a href={queueHref}>Back to Sessions</a>
      </section>
    );
  if (!workspace)
    return (
      <section
        aria-busy="true"
        aria-label="Sales Session workspace loading"
        className={styles.loading}
      >
        Loading Sales Session…
      </section>
    );
  const areaHref = (next: Area) =>
    `/sales/sessions/${encodeURIComponent(sessionId)}?area=${next}&from=${encodeURIComponent(queueHref)}`;
  const queueIsHistory =
    new URLSearchParams(queueHref.split("?")[1] ?? "").get("queue") ===
    "history";
  const verifyNow = async () => {
    if (requestInFlight.current) return;
    requestInFlight.current = true;
    const token = lifecycle.current.token;
    const request = authenticatedRequest(token);
    setVerifying(true);
    setVerificationCorrelationId(null);
    setVerification("Verifying this Sales Session with CloudShare…");
    try {
      const response = await request(
        `/api/sales/enablement-sessions/${encodeURIComponent(sessionId)}/verify`,
        { method: "POST" },
      );
      const body = (await response.json()) as SalesSessionVerifyResponse & {
        error?: string;
      };
      if (!lifecycle.current.active || lifecycle.current.token !== token)
        return;
      setVerificationCorrelationId(
        typeof body.correlationId === "string" ? body.correlationId : null,
      );
      if (!response.ok) {
        throw new Error(
          body.error ?? "Verification failed. Retry or open Sales support.",
        );
      }
      if (
        body.source !== "cloudshare_v4_get_sales" ||
        !body.correlationId ||
        !body.observedAt ||
        !["notStarted", "inProgress", "ended"].includes(
          body.experienceStatus,
        ) ||
        body.freshness !== "fresh"
      )
        throw new Error(
          "CloudShare returned an incomplete verification observation. Retry or open Sales support.",
        );
      setWorkspace((current) =>
        current
          ? {
              ...current,
              summary: {
                ...current.summary,
                experience: {
                  value: body.experienceStatus,
                  source: body.source,
                  freshness: body.freshness,
                  observedAt: body.observedAt,
                },
              },
            }
          : current,
      );
      setVerification(
        `Verified from CloudShare: ${body.experienceStatus} at ${body.observedAt}. Correlation ${body.correlationId}.`,
      );
      router.refresh();
    } catch (cause) {
      if (lifecycle.current.active && lifecycle.current.token === token)
        setVerification(
          cause instanceof Error
            ? `${cause.message} Retry or open Sales support.`
            : "Verification failed. Retry or open Sales support.",
        );
    } finally {
      if (lifecycle.current.active && lifecycle.current.token === token) {
        setVerifying(false);
        requestInFlight.current = false;
      }
    }
  };
  const activityHistory = workspace.activityHistory ?? {
    complete: true,
    hasMore: false,
  };
  const participantRows = workspace.participants;
  useEffect(() => {
    const next = reconcileParticipantRowInteraction(
      rowInteraction.current,
      participantRows.map((p) => p.id),
    );
    rowInteraction.current = next;
    setActiveParticipantId(next.activeId);
    setSelectedParticipantIds(new Set(next.selectedIds));
    selectionAnchor.current = next.anchorId;
  }, [participantRows]);
  const selectParticipant = (
    id: string,
    event?: {
      readonly shiftKey?: boolean;
      readonly metaKey?: boolean;
      readonly ctrlKey?: boolean;
    },
  ) => {
    const next = reduceParticipantRowInteraction(rowInteraction.current, {
      type: "select",
      id,
      ids: participantRows.map((p) => p.id),
      shift: event?.shiftKey,
      toggle: event?.metaKey || event?.ctrlKey,
    });
    rowInteraction.current = next;
    setActiveParticipantId(next.activeId);
    setSelectedParticipantIds(new Set(next.selectedIds));
    selectionAnchor.current = next.anchorId;
  };
  const handleParticipantKeyDown = (
    event: React.KeyboardEvent<HTMLTableRowElement>,
    index: number,
  ) => {
    const id = participantRows[index]?.id;
    if (!id) return;
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      const next = reduceParticipantRowInteraction(rowInteraction.current, {
        type: "move",
        direction: event.key === "ArrowDown" ? "next" : "previous",
        ids: participantRows.map((p) => p.id),
      });
      rowInteraction.current = next;
      setActiveParticipantId(next.activeId);
      document.getElementById(`participant-${next.activeId}`)?.focus();
    } else if (event.key === " " || event.key === "Spacebar") {
      event.preventDefault();
      selectParticipant(id, { shiftKey: event.shiftKey, ctrlKey: true });
    } else if (event.key === "Enter") {
      event.preventDefault();
      originRow.current = id;
      const next = reduceParticipantRowInteraction(rowInteraction.current, {
        type: "inspect",
        id,
      });
      rowInteraction.current = next;
      setActiveParticipantId(id);
      requestAnimationFrame(() => inspectorRef.current?.focus());
    } else if (event.key === "Escape") {
      event.preventDefault();
      document
        .getElementById(`participant-${originRow.current ?? id}`)
        ?.focus();
    }
  };
  const activeParticipant =
    participantRows.find(
      (participant) => participant.id === activeParticipantId,
    ) ??
    participantRows[0] ??
    null;
  const actionState = activeParticipant?.actionState ?? {
    primary: "diagnostics" as const,
    canInvite: false,
    canLaunch: false,
    canRevoke: false,
    hasActiveLaunchLink: false,
    reason:
      "Participant action availability is unavailable; open Diagnostics for support.",
  };
  const operationCoordinator = useMemo(
    () =>
      createSalesParticipantOperationCoordinator({
        execute: async ({ participantId, operation }) => {
          const action = operation === "resend" ? "invite" : operation;
          const path =
            action === "invite"
              ? `/api/sales/enablement-sessions/${encodeURIComponent(sessionId)}/participants/invite`
              : `/api/sales/enablement-sessions/${encodeURIComponent(sessionId)}/participants/${encodeURIComponent(participantId)}/launch-link`;
          const response = await authenticatedRequest(lifecycle.current.token)(
            path,
            action === "invite"
              ? {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({ participantIds: [participantId] }),
                }
              : { method: action === "launch" ? "POST" : "DELETE" },
          );
          const body = (await response.json()) as {
            error?: string;
            correlationId?: string;
            launchUrl?: unknown;
            invitationConfirmation?: unknown;
        retryDisposition?: "retryable" | "no_replay";
          };
          const projected = projectSalesParticipantBrowserActionResult({
            ok: response.ok,
            responseStatus: response.status,
            action,
            ...body,
          });
          return {
            disposition: projected.ok
              ? projected.invitationConfirmation === "pending"
                ? "pending_confirmation"
                : "confirmed"
              : projected.retryDisposition === "no-replay"
                ? "no_replay"
                : "failed_retryable",
            correlationId: projected.correlationId,
            metadata: {
              launchUrl:
                projected.ok && typeof projected.launchUrl === "string"
                  ? projected.launchUrl
                  : null,
            },
          };
        },
      }),
    [authenticatedRequest, sessionId],
  );
  const participantAction = async (
    participantId: string,
    action: "invite" | "launch" | "revoke",
  ) => {
    setParticipantFeedback((current) => ({
      ...current,
      [participantId]: { ok: true, message: `${action} pending…` },
    }));
    try {
      const outcome = await operationCoordinator.run({
        participantId,
        operation: action === "invite" ? "invite" : action,
        capability: action === "invite" ? "email" : "launch",
      });
      const message =
        outcome.disposition === "no_replay"
          ? "Request outcome is ambiguous. Do not retry; review Sales support."
          : outcome.disposition === "pending_confirmation"
            ? "Invitation pending confirmation. Do not retry."
            : outcome.disposition === "failed_retryable"
              ? "Request failed; retry is available."
              : `${action} completed.`;
      setParticipantFeedback((current) => ({
        ...current,
        [participantId]: {
          ok:
            outcome.disposition !== "failed_retryable" &&
            outcome.disposition !== "no_replay",
          message,
          correlationId: outcome.correlationId,
          launchUrl:
            typeof outcome.metadata?.launchUrl === "string"
              ? outcome.metadata.launchUrl
              : undefined,
        },
      }));
      const next = await rosterReader.read({
        sessionId,
        query: participantQuery,
        page: participantPage,
        pageSize: 25,
      });
      if (next.ok) {
        setWorkspace(next.data);
        lastSafeWorkspaceRef.current = next.data;
      } else if (next.lastSafe) setWorkspace(next.lastSafe);
    } catch (cause) {
      setParticipantFeedback((current) => ({
        ...current,
        [participantId]: {
          ok: false,
          message: cause instanceof Error ? cause.message : `${action} failed.`,
        },
      }));
    }
  };
  return (
    <section aria-label="Sales Session workspace" className={styles.workspace}>
      {error ? (
        <div role="alert" className={styles.error}>
          <strong>Latest workspace read unavailable.</strong>{" "}
          <span>{error}</span>{" "}
          <button
            type="button"
            onClick={() => {
              setError(null);
              setWorkspaceRetry((value) => value + 1);
            }}
          >
            Retry
          </button>
        </div>
      ) : null}
      <header className={styles.summary}>
        <div className={styles.summaryTopline}>
          <div className={styles.contextTrail}>
            <a aria-label="Back to Sessions" href={queueHref}>
              <span aria-hidden="true">← </span>Sessions
            </a>
            <span aria-hidden="true"> / </span>
            <span>{queueIsHistory ? "History" : "Session"}</span>
            <span aria-hidden="true"> / </span>
            <span aria-current="page">{workspace.summary.sessionName}</span>
          </div>
          <span>Revision {workspace.summary.revision}</span>
        </div>
        <div className={styles.summaryTitle}>
          <div>
            <p className={styles.eyebrow}>Sales Enablement Session</p>
            <h1>{workspace.summary.sessionName}</h1>
          </div>
          <span
            className={styles.statusBadge}
            style={statusBadgeStyle(
              operationPresentation(workspace.summary.operation.value).tone,
            )}
          >
            {operationPresentation(workspace.summary.operation.value).label}
          </span>
          <button
            type="button"
            className={styles.areaTab}
            onClick={() => void verifyNow()}
            disabled={verifying || refreshBusy}
          >
            {verifying ? "Verifying…" : "Verify now"}
          </button>
        </div>
        {automaticRefresh ? (
          <p aria-live="polite">
            {automaticRefresh}{" "}
            {refreshOutcome === "failure" ? (
              <>
                <button
                  type="button"
                  onClick={() => void retryAutomaticRefresh()}
                >
                  Retry
                </button>
                {refreshCorrelationId ? (
                  <a
                    href={`/sales?tab=support&correlationId=${encodeURIComponent(refreshCorrelationId)}`}
                  >
                    Open Sales support
                  </a>
                ) : (
                  <a href="/sales?tab=support">Open Sales support</a>
                )}
              </>
            ) : null}
          </p>
        ) : null}
        {verification ? (
          <div role="status">
            <p>{verification}</p>
            {verificationCorrelationId ? (
              <a
                href={`/sales?tab=support&correlationId=${encodeURIComponent(verificationCorrelationId)}`}
              >
                Open Sales support
              </a>
            ) : null}
          </div>
        ) : null}
        <dl className={styles.summaryMetrics}>
          <SummaryMetric label="Time window">
            <time dateTime={workspace.summary.start}>
              {workspace.summary.start}
            </time>
            <span> · {workspace.summary.timeZone}</span>
            <time dateTime={workspace.summary.end}>
              {workspace.summary.end}
            </time>
          </SummaryMetric>
          <SummaryMetric label="Certalis operation">
            <strong>
              {operationPresentation(workspace.summary.operation.value).label}
            </strong>
            <span>
              {workspace.summary.operation.value === "needs_attention"
                ? workspace.summary.operation.reason
                : "Recorded by Certalis."}
            </span>
          </SummaryMetric>
          <SummaryMetric label="CloudShare Experience">
            <strong>
              {humanExperience(workspace.summary.experience.value)}
            </strong>
            <span>
              {workspace.summary.experience.freshness === "fresh"
                ? "Recently observed from CloudShare."
                : "Schedule estimate; not recently confirmed with CloudShare."}
            </span>
          </SummaryMetric>
          <SummaryMetric label="Configuration">
            <strong>{workspace.details.itemName}</strong>
            <span>{workspace.details.invitationMode}</span>
          </SummaryMetric>
        </dl>
      </header>
      <nav aria-label="Session workspace areas" className={styles.areaNav}>
        <span className={styles.areaNavLabel}>Session workspace</span>
        <div className={styles.areaTabs}>
          {(["participants", "activity", "details"] as const).map(
            (candidate) => (
              <a
                key={candidate}
                className={
                  area === candidate ? styles.areaTabActive : styles.areaTab
                }
                href={areaHref(candidate)}
                aria-current={area === candidate ? "page" : undefined}
              >
                {candidate[0].toUpperCase() + candidate.slice(1)}
              </a>
            ),
          )}
        </div>
      </nav>
      {area === "participants" ? (
        <section className={styles.panel}>
          <div className={styles.panelHeading}>
            <div>
              <h2 ref={areaHeading} tabIndex={-1}>
                Participants
              </h2>
              <p>
                Search by name or email. Select a row to inspect and act on one
                Participant.
              </p>
            </div>
            <span className={styles.count}>
              {participantRows.length} of{" "}
              {workspace.participantPage?.total ?? participantRows.length}
            </span>
          </div>
          <label>
            Search Participants by name or email{" "}
            <input
              aria-label="Search Participants by name or email"
              value={participantQuery}
              onChange={(event) => setParticipantQuery(event.target.value)}
            />
          </label>
          <nav aria-label="Participant pages" className={styles.areaNav}>
            <span>Showing a bounded page of Participants.</span>
            <button
              type="button"
              disabled={participantPage === 0}
              onClick={() =>
                setParticipantPage((page) => Math.max(0, page - 1))
              }
            >
              Previous
            </button>
            <button
              type="button"
              disabled={!workspace.participantPage?.hasMore}
              onClick={() => setParticipantPage((page) => page + 1)}
            >
              Next
            </button>
          </nav>
          {workspace.participants.length ? (
            <div className={styles.participantLayout}>
              <div className={styles.tableWrap}>
                <table
                  aria-label="Participant roster preview"
                  className={styles.roster}
                >
                  <thead>
                    <tr>
                      <th>Participant</th>
                      <th>Invitation</th>
                      <th>Participation</th>
                      <th>Participant Environment</th>
                      <th>Environment source</th>
                    </tr>
                  </thead>
                  <tbody>
                    {participantRows.map((participant, index) => (
                      <tr
                        key={participant.id}
                        id={`participant-${participant.id}`}
                        tabIndex={0}
                        aria-selected={selectedParticipantIds.has(
                          participant.id,
                        )}
                        onClick={(event) =>
                          selectParticipant(participant.id, event)
                        }
                        onKeyDown={(event) =>
                          handleParticipantKeyDown(event, index)
                        }
                      >
                        <th scope="row">
                          <strong>{participant.name}</strong>
                          <span>{participant.email}</span>
                        </th>
                        <td>
                          <span className={styles.inlineBadge}>
                            {humanInvitation(participant.invitationStatus)}
                          </span>
                        </td>
                        <td>
                          <span className={styles.inlineBadge}>
                            {humanParticipation(
                              participant.participationStatus,
                            )}
                          </span>
                        </td>
                        <td>
                          {participant.environment.value ?? "Not observed"}
                          {"observedAt" in participant.environment ? (
                            <span className={styles.muted}>
                              {participant.environment.observedAt}
                            </span>
                          ) : null}
                          {participant.environmentAttention ? (
                            <span className={styles.environmentAttention}>
                              <strong>Needs attention</strong>
                              {participant.environmentAttention.reason}
                            </span>
                          ) : null}
                        </td>
                        <td>
                          {humanEnvironmentSource(
                            participant.environment.source,
                          )}
                          {participant.environmentAttention ? (
                            <span className={styles.muted}>
                              Attention source:{" "}
                              {participant.environmentAttention.source}
                            </span>
                          ) : null}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {activeParticipant ? (
                <aside
                  ref={inspectorRef}
                  tabIndex={-1}
                  aria-label="Participant inspector"
                  className={styles.inspector}
                  onKeyDown={(event) => {
                    if (event.key === "Escape") {
                      event.preventDefault();
                      revokeTriggerRef.current?.focus();
                    }
                  }}
                >
                  <h3>{activeParticipant.name}</h3>
                  <p>{activeParticipant.email}</p>
                  <dl>
                    <div>
                      <dt>Invitation</dt>
                      <dd>
                        {humanInvitation(activeParticipant.invitationStatus)}
                      </dd>
                    </div>
                    <div>
                      <dt>Participation</dt>
                      <dd>
                        {humanParticipation(
                          activeParticipant.participationStatus,
                        )}
                      </dd>
                    </div>
                    <div>
                      <dt>Participant Environment</dt>
                      <dd>
                        {activeParticipant.environment.value ?? "Not observed"}{" "}
                        (
                        {humanEnvironmentSource(
                          activeParticipant.environment.source,
                        )}
                        )
                      </dd>
                    </div>
                  </dl>
                  <p>
                    <strong>Certalis operation:</strong>{" "}
                    {
                      operationPresentation(workspace.summary.operation.value)
                        .label
                    }
                    {workspace.summary.operation.value === "needs_attention"
                      ? ` — ${workspace.summary.operation.reason}`
                      : ""}
                  </p>
                  <p>
                    <strong>CloudShare Experience:</strong>{" "}
                    {humanExperience(workspace.summary.experience.value)}
                  </p>
                  <p className={styles.previewNote}>
                    Session operation: participant actions are Customer-scoped
                    and auditable.
                  </p>
                  <div>
                    <button
                      type="button"
                      onClick={() =>
                        void participantAction(activeParticipant.id, "invite")
                      }
                      disabled={!actionState?.canInvite}
                      className={
                        actionState?.primary === "invite" ||
                        actionState?.primary === "resend"
                          ? styles.areaTabActive
                          : undefined
                      }
                      title={
                        !actionState?.canInvite
                          ? actionState?.reason
                          : undefined
                      }
                    >
                      {activeParticipant.invitationStatus === "sent"
                        ? "Resend Invite"
                        : "Invite"}
                    </button>
                    <button
                      type="button"
                      className={
                        actionState?.primary === "launch"
                          ? styles.areaTabActive
                          : undefined
                      }
                      title={
                        !actionState?.canLaunch
                          ? actionState?.reason
                          : undefined
                      }
                      disabled={!actionState?.canLaunch}
                      onClick={() =>
                        void participantAction(activeParticipant.id, "launch")
                      }
                    >
                      Generate launch link
                    </button>
                    <button
                      type="button"
                      className={styles.failureBadge}
                      title={
                        !actionState?.canRevoke
                          ? actionState?.reason
                          : undefined
                      }
                      disabled={!actionState?.canRevoke}
                      ref={revokeTriggerRef}
                      onClick={() => setRevokeOpen(true)}
                    >
                      Revoke launch link
                    </button>
                    <span>{actionState?.reason}</span>
                    <a
                      href={`/sales?tab=activity&sessionId=${encodeURIComponent(sessionId)}&participantId=${encodeURIComponent(activeParticipant.id)}`}
                    >
                      View Activity
                    </a>
                    <a
                      className={
                        actionState?.primary === "diagnostics"
                          ? styles.areaTabActive
                          : undefined
                      }
                      href={`/sales?tab=support&subjectId=${encodeURIComponent(activeParticipant.id)}`}
                    >
                      Diagnostics
                    </a>
                    {participantFeedback[activeParticipant.id] ? (
                      <p
                        role={
                          participantFeedback[activeParticipant.id].ok
                            ? "status"
                            : "alert"
                        }
                      >
                        {participantFeedback[activeParticipant.id].message}{" "}
                        {participantFeedback[activeParticipant.id]
                          .correlationId ? (
                          <a
                            href={`/sales?tab=support&correlationId=${encodeURIComponent(participantFeedback[activeParticipant.id].correlationId!)}`}
                          >
                            Open Sales support
                          </a>
                        ) : null}{" "}
                        {participantFeedback[activeParticipant.id].launchUrl ? (
                          <a
                            href={
                              participantFeedback[activeParticipant.id]
                                .launchUrl
                            }
                          >
                            Open launch link
                          </a>
                        ) : null}
                        {participantFeedback[
                          activeParticipant.id
                        ].message.includes("roster read unavailable") ? (
                          <button
                            type="button"
                            onClick={async () => {
                              const result = await rosterReader.retry();
                              if (result.ok) {
                                setWorkspace(result.data);
                                lastSafeWorkspaceRef.current = result.data;
                                setError(null);
                              } else {
                                setError(result.error);
                                if (result.lastSafe) setWorkspace(result.lastSafe);
                              }
                            }}
                          >
                            Retry roster read
                          </button>
                        ) : null}
                      </p>
                    ) : null}
                    {revokeOpen ? (
                      <div
                        role="dialog"
                        aria-modal="true"
                        aria-labelledby="revoke-title"
                        onKeyDown={(event) => {
                          if (event.key === "Tab") {
                            const focusables = Array.from(
                              event.currentTarget.querySelectorAll<HTMLElement>(
                                "button, a[href]",
                              ),
                            );
                            if (focusables.length) {
                              const first = focusables[0],
                                last = focusables[focusables.length - 1];
                              if (
                                event.shiftKey &&
                                document.activeElement === first
                              ) {
                                event.preventDefault();
                                last.focus();
                              } else if (
                                !event.shiftKey &&
                                document.activeElement === last
                              ) {
                                event.preventDefault();
                                first.focus();
                              }
                            }
                          } else if (event.key === "Escape") {
                            event.preventDefault();
                            setRevokeOpen(false);
                            revokeTriggerRef.current?.focus();
                            requestAnimationFrame(() =>
                              revokeTriggerRef.current?.focus(),
                            );
                          }
                        }}
                      >
                        <h4 id="revoke-title">Revoke launch link?</h4>
                        <p>
                          This prevents this Participant from using the current
                          launch link.
                        </p>
                        <button
                          type="button"
                          onClick={() => {
                            setRevokeOpen(false);
                            revokeTriggerRef.current?.focus();
                            requestAnimationFrame(() =>
                              revokeTriggerRef.current?.focus(),
                            );
                          }}
                        >
                          Cancel
                        </button>
                        <button
                          ref={revokeConfirmRef}
                          type="button"
                          onClick={() => {
                            setRevokeOpen(false);
                            void participantAction(
                              activeParticipant.id,
                              "revoke",
                            );
                            revokeTriggerRef.current?.focus();
                            requestAnimationFrame(() =>
                              revokeTriggerRef.current?.focus(),
                            );
                          }}
                        >
                          Revoke
                        </button>
                      </div>
                    ) : null}
                  </div>
                  <p className={styles.previewNote}>
                    Detailed participant management follows in a later
                    workspace.
                  </p>
                </aside>
              ) : null}
            </div>
          ) : (
            <p className={styles.empty}>
              No persisted Participants are registered for this Sales Session.
            </p>
          )}
        </section>
      ) : null}
      {area === "activity" ? (
        <section className={styles.panel}>
          <div className={styles.panelHeading}>
            <div>
              <h2 ref={areaHeading} tabIndex={-1}>
                Activity
              </h2>
              <p>Grouped operational history for this Sales Session.</p>
            </div>
          </div>
          <p className={styles.activityExplainer}>
            Activity shows ordinary operational metadata only. Open Support
            Diagnostics for authorized Customer-scoped evidence when a support
            investigation is available.
          </p>
          {activityHistory.complete ? null : (
            <p role="status">
              Activity history is incomplete; some older records are not shown.
            </p>
          )}
          {activity.length ? (
            <ol
              aria-label="Sales Session activity timeline"
              className={styles.timeline}
            >
              {activity.map((entry) => (
                <li key={entry.workflowId} className={styles.timelineItem}>
                  <span
                    className={
                      entry.outcome === "failure"
                        ? styles.failureDot
                        : entry.outcome === "success"
                          ? styles.successDot
                          : styles.warningDot
                    }
                    aria-hidden="true"
                  />
                  <div className={styles.timelineBody}>
                    <div className={styles.timelineTitle}>
                      <strong>{entry.summary}</strong>
                      <span
                        className={
                          entry.outcome === "failure"
                            ? styles.failureBadge
                            : entry.outcome === "success"
                              ? styles.successBadge
                              : styles.inlineBadge
                        }
                      >
                        {entry.outcome === "failure"
                          ? "Failed"
                          : entry.outcome === "mixed"
                            ? "Mixed evidence"
                            : entry.outcome === "incomplete"
                              ? "Incomplete"
                              : "Completed"}
                      </span>
                    </div>
                    <div className={styles.timelineMeta}>
                      <ActivityTimeRange
                        firstAt={entry.firstAt}
                        lastAt={entry.lastAt}
                      />
                      <span>Actor: {entry.actor}</span>
                    </div>
                    <div className={styles.correlationThreads}>
                      {entry.correlationId ? (
                        <a
                          href={`/sales?tab=support&correlationId=${encodeURIComponent(entry.correlationId)}`}
                        >
                          Open Sales support investigation
                        </a>
                      ) : (
                        <a href="/sales?tab=support">Open Sales support</a>
                      )}
                    </div>
                  </div>
                </li>
              ))}
            </ol>
          ) : (
            <p className={styles.empty}>
              No safe Activity has been recorded for this Sales Session.
            </p>
          )}
        </section>
      ) : null}
      {area === "details" ? (
        <section className={styles.panel}>
          <div className={styles.panelHeading}>
            <div>
              <h2 ref={areaHeading} tabIndex={-1}>
                Details
              </h2>
              <p>
                Relationships and configuration retained by Certalis for this
                Session.
              </p>
            </div>
          </div>
          <div className={styles.detailGrid}>
            <DetailGroup
              label="Sales relationship"
              values={[
                ["Account", workspace.details.accountName],
                ["Opportunity", workspace.details.opportunityName],
              ]}
            />
            <DetailGroup
              label="Session configuration"
              values={[
                ["Item", workspace.details.itemName],
                ["Native invitations", workspace.details.invitationMode],
                ["Time zone", workspace.summary.timeZone],
              ]}
            />
          </div>
        </section>
      ) : null}
    </section>
  );
}

function SummaryMetric({
  label,
  children,
}: {
  readonly label: string;
  readonly children: React.ReactNode;
}) {
  return (
    <div>
      <dt>{label}</dt>
      <dd>{children}</dd>
    </div>
  );
}
function DetailGroup({
  label,
  values,
}: {
  readonly label: string;
  readonly values: readonly (readonly [string, string])[];
}) {
  return (
    <section aria-label={label} className={styles.detailGroup}>
      <h3>{label}</h3>
      <dl>
        {values.map(([term, value]) => (
          <div key={term}>
            <dt>{term}</dt>
            <dd>{value}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}
function ActivityTimeRange({
  firstAt,
  lastAt,
}: {
  readonly firstAt: string;
  readonly lastAt: string;
}) {
  return firstAt === lastAt ? (
    <time dateTime={firstAt}>{firstAt}</time>
  ) : (
    <span>
      <time dateTime={firstAt}>{firstAt}</time> to{" "}
      <time dateTime={lastAt}>{lastAt}</time>
    </span>
  );
}
function operationPresentation(value: string): {
  readonly label: string;
  readonly tone: "positive" | "warning" | "info";
} {
  return value === "needs_attention"
    ? { label: "Needs attention", tone: "warning" }
    : value === "provisioning"
      ? { label: "Provisioning", tone: "info" }
      : { label: "Correlated", tone: "positive" };
}
function humanExperience(value: string): string {
  return value === "notStarted"
    ? "Not started"
    : value === "inProgress"
      ? "In progress"
      : value === "ended"
        ? "Ended"
        : "Not observed";
}
function humanInvitation(value: string): string {
  return value === "sent" ? "Sent" : "Not sent";
}
function humanParticipation(value: string): string {
  return value === "inProgress"
    ? "In progress"
    : value === "concluded"
      ? "Concluded"
      : "Pending";
}
function humanEnvironmentSource(value: string): string {
  if (value === "cloudshare_v3_environment")
    return "Observed from CloudShare Environment";
  if (value === "cloudshare_v4_sales_participant_roster")
    return "Observed from CloudShare participant roster";
  if (value === "not_assigned") return "No CloudShare Environment is assigned";
  return "CloudShare Environment state has not been observed";
}
