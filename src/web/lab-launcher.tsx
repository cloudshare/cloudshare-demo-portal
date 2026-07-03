"use client";

import React, { useState, useEffect, useRef, useCallback } from "react";
import { openEnterExamWindow } from "./enter-exam";
import { isLabWindowOpen } from "./lab-window";
import { endLabAttempt, preflightLabAction, readHeartbeatAttemptStatus, resumeLabAttempt, suspendLabAttempt, type CandidateLabStatus, type AttemptStatus } from "./lab-launcher-client";
import { describeAndReportLaunchFailure } from "./lab-launcher-runtime-diagnostics";
import {
  getAttemptStatusAfterLaunchTransition,
  getLauncherPresentation,
  getLauncherRecoveryAction,
  getLauncherSyncTarget,
  type LaunchState,
} from "./lab-launcher-state";

const HEARTBEAT_INTERVAL_MS = 15_000;
const CHILD_POLL_INTERVAL_MS = 3_000;
export const END_EXAM_CONFIRMATION_MESSAGE =
  "Ending this exam will archive your CloudShare lab and you will lose access to this ExamAttempt. This cannot be undone.";

export function confirmCandidateEndExam(
  confirmImpl?: (message: string) => boolean,
): boolean {
  const confirmFn =
    confirmImpl ??
    (typeof window !== "undefined" && typeof window.confirm === "function"
      ? window.confirm.bind(window)
      : null);
  return confirmFn ? confirmFn(END_EXAM_CONFIRMATION_MESSAGE) : true;
}

export function getEndExamPendingLaunchState(input: {
  readonly environmentArchived: boolean;
  readonly labStatus: CandidateLabStatus | null;
}): LaunchState {
  if (input.environmentArchived) {
    return "completion_pending";
  }
  return input.labStatus?.status === "suspended" ? "suspended" : "open";
}

/**
 * Candidate-facing control that launches the lab, then keeps a heartbeat alive
 * while the lab window is open. If the candidate closes the lab window the
 * component detects it via `childWindow.closed` polling and proactively
 * suspends. `sendBeacon` fires on `pagehide`/`visibilitychange` as a fast-path
 * signal so the server auto-suspend timer resets on every page-visibility change.
 */
export function LabLauncher({
  examAttemptId,
  currentAttemptStatus = "ready",
  openPeriodClosed = false,
  onAttemptStatusChange,
  onLabStatusLoaded,
}: {
  examAttemptId: string;
  currentAttemptStatus?: AttemptStatus;
  openPeriodClosed?: boolean;
  onAttemptStatusChange?: (status: AttemptStatus) => void;
  onLabStatusLoaded?: (status: CandidateLabStatus) => void;
}) {
  const [state, setState] = useState<LaunchState>(
    currentAttemptStatus === "completed"
      ? "completed"
      : currentAttemptStatus === "suspended"
        ? "suspended"
        : "idle",
  );
  const [message, setMessage] = useState<string>("");
  const [launcherAttemptStatus, setLauncherAttemptStatus] = useState<AttemptStatus>(currentAttemptStatus);
  const heartbeatRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const childPollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const actionInFlightRef = useRef(false);
  const lastReportedAttemptStatusRef = useRef<AttemptStatus | null>(null);
  const currentAttemptStatusRef = useRef(currentAttemptStatus);
  const onAttemptStatusChangeRef = useRef(onAttemptStatusChange);
  const onLabStatusLoadedRef = useRef(onLabStatusLoaded);

  useEffect(() => {
    currentAttemptStatusRef.current = currentAttemptStatus;
    setLauncherAttemptStatus(currentAttemptStatus);
  }, [currentAttemptStatus]);

  useEffect(() => {
    onAttemptStatusChangeRef.current = onAttemptStatusChange;
  }, [onAttemptStatusChange]);

  useEffect(() => {
    onLabStatusLoadedRef.current = onLabStatusLoaded;
  }, [onLabStatusLoaded]);

  const reportAttemptStatusChange = useCallback((status: AttemptStatus) => {
    currentAttemptStatusRef.current = status;
    setLauncherAttemptStatus(status);
    if (lastReportedAttemptStatusRef.current === status) {
      return;
    }
    lastReportedAttemptStatusRef.current = status;
    onAttemptStatusChangeRef.current?.(status);
  }, []);

  const reportLabStatusLoaded = useCallback((status: CandidateLabStatus) => {
    onLabStatusLoadedRef.current?.(status);
  }, []);

  const syncToAuthoritativeAttemptStatus = useCallback((status: AttemptStatus) => {
    const target = getLauncherSyncTarget(status);
    if (!target) {
      return;
    }

    stopHeartbeat();
    stopChildPoll();
    setState((current) => (current === target.state ? current : target.state));
    setMessage((current) => (current === target.message ? current : target.message));
    reportAttemptStatusChange(status);
  }, [reportAttemptStatusChange]);

  async function sendHeartbeat() {
    const response = await fetch("/api/heartbeat", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ examAttemptId }),
    });
    const body = await response.json().catch(() => ({}));
    const attemptStatus = readHeartbeatAttemptStatus(body);
    if (attemptStatus === "suspended" || attemptStatus === "completed") {
      syncToAuthoritativeAttemptStatus(attemptStatus);
    }
  }

  function sendBeaconHeartbeat() {
    if (typeof navigator !== "undefined" && navigator.sendBeacon) {
      navigator.sendBeacon(
        "/api/heartbeat",
        new Blob([JSON.stringify({ examAttemptId })], { type: "application/json" }),
      );
    }
  }

  function startHeartbeat() {
    void sendHeartbeat().catch(() => {
      // best-effort; server timeout is the reliable backstop
    });
    heartbeatRef.current = setInterval(() => {
      void sendHeartbeat().catch(() => {
        // best-effort; server timeout is the reliable backstop
      });
    }, HEARTBEAT_INTERVAL_MS);
  }

  function stopHeartbeat() {
    if (heartbeatRef.current !== null) {
      clearInterval(heartbeatRef.current);
      heartbeatRef.current = null;
    }
  }

  function stopChildPoll() {
    if (childPollRef.current !== null) {
      clearInterval(childPollRef.current);
      childPollRef.current = null;
    }
  }

  async function suspendNow() {
    if (actionInFlightRef.current) {
      return;
    }
    actionInFlightRef.current = true;
    if (currentAttemptStatusRef.current === "completed") {
      setState("completed");
      setMessage("Examination complete.");
      actionInFlightRef.current = false;
      return;
    }
    stopHeartbeat();
    stopChildPoll();
    setState("suspending");
    try {
      const result = await suspendLabAttempt(fetch, examAttemptId);
      if (result.kind === "pending") {
        if (result.labStatus) {
          reportLabStatusLoaded(result.labStatus);
          reportAttemptStatusChange(result.labStatus.status);
        }
        setState(result.labStatus?.status === "suspended" ? "suspended" : "open");
        setMessage(result.message);
        return;
      }
      if (result.kind === "completed") {
        reportLabStatusLoaded(result.labStatus);
        syncToAuthoritativeAttemptStatus("completed");
        return;
      }
      if (result.kind === "blocked") {
        if (result.labStatus) {
          reportLabStatusLoaded(result.labStatus);
          reportAttemptStatusChange(result.labStatus.status);
        }
        setState(result.labStatus?.status === "suspended" ? "suspended" : "error");
        setMessage(result.message);
        return;
      }
      setState("suspended");
      setMessage(result.message);
      reportAttemptStatusChange("suspended");
    } catch (err) {
      setState("error");
      setMessage(err instanceof Error ? err.message : "suspend failed");
    } finally {
      actionInFlightRef.current = false;
    }
  }

  async function launch() {
    if (actionInFlightRef.current) {
      return;
    }
    actionInFlightRef.current = true;
    if (currentAttemptStatusRef.current === "completed") {
      setState("completed");
      setMessage("Examination complete.");
      actionInFlightRef.current = false;
      return;
    }
    try {
      setState("launching");
      setMessage("");
      const preflight = await preflightLabAction(fetch, {
        examAttemptId,
        action: "enter",
      });
      reportLabStatusLoaded(preflight.labStatus);
      reportAttemptStatusChange(preflight.labStatus.status);
      if (preflight.kind === "completed") {
        syncToAuthoritativeAttemptStatus("completed");
        return;
      }
      if (preflight.kind === "blocked") {
        setState("error");
        setMessage(preflight.message);
        return;
      }
      try {
        openEnterExamWindow(examAttemptId);
      } catch (error) {
        setState("error");
        setMessage(
          await describeAndReportLaunchFailure(fetch, {
            error,
            examAttemptId,
            attemptedAction:
              currentAttemptStatusRef.current === "in_progress" ? "open" : "enter",
            attemptStatus: currentAttemptStatusRef.current,
          }),
        );
        return;
      }
      reportAttemptStatusChange("in_progress");
      setState("open");
    } catch (err) {
      setState("error");
      setMessage(
        err instanceof Error ? err.message : "launch failed",
      );
    } finally {
      actionInFlightRef.current = false;
    }
  }

  async function resumeNow() {
    if (actionInFlightRef.current) {
      return;
    }
    actionInFlightRef.current = true;
    if (currentAttemptStatusRef.current === "completed") {
      setState("completed");
      setMessage("Examination complete.");
      actionInFlightRef.current = false;
      return;
    }
    try {
      setState("launching");
      setMessage("");
      const preflight = await preflightLabAction(fetch, {
        examAttemptId,
        action: "resume",
      });
      reportLabStatusLoaded(preflight.labStatus);
      reportAttemptStatusChange(preflight.labStatus.status);
      if (preflight.kind === "completed") {
        syncToAuthoritativeAttemptStatus("completed");
        return;
      }
      if (preflight.kind === "blocked") {
        setState("error");
        setMessage(preflight.message);
        return;
      }
      const result = await resumeLabAttempt(fetch, examAttemptId);
      if (result.kind === "pending") {
        if (result.labStatus) {
          reportLabStatusLoaded(result.labStatus);
          reportAttemptStatusChange(result.labStatus.status);
        }
        setState(result.labStatus?.status === "suspended" ? "suspended" : "error");
        setMessage(result.message);
        return;
      }
      if (result.kind === "completed") {
        reportLabStatusLoaded(result.labStatus);
        syncToAuthoritativeAttemptStatus("completed");
        return;
      }
      if (result.kind === "blocked") {
        if (result.labStatus) {
          reportLabStatusLoaded(result.labStatus);
          reportAttemptStatusChange(result.labStatus.status);
        }
        setState(result.labStatus?.status === "suspended" ? "suspended" : "error");
        setMessage(result.message);
        return;
      }
      reportAttemptStatusChange(
        getAttemptStatusAfterLaunchTransition(currentAttemptStatusRef.current, "resume"),
      );
      try {
        openEnterExamWindow(examAttemptId);
      } catch (error) {
        setState("error");
        setMessage(
          await describeAndReportLaunchFailure(fetch, {
            error,
            examAttemptId,
            attemptedAction:
              currentAttemptStatusRef.current === "in_progress" ? "open" : "resume",
            attemptStatus: currentAttemptStatusRef.current,
          }),
        );
        return;
      }
      setState("open");
    } catch (err) {
      setState("error");
      setMessage(
        err instanceof Error ? err.message : "resume failed",
      );
    } finally {
      actionInFlightRef.current = false;
    }
  }

  async function endNow() {
    if (actionInFlightRef.current) {
      return;
    }
    if (currentAttemptStatusRef.current === "completed") {
      setState("completed");
      setMessage("Examination complete.");
      return;
    }
    if (!confirmCandidateEndExam()) {
      return;
    }
    actionInFlightRef.current = true;
    stopHeartbeat();
    stopChildPoll();
    setState("ending");
    setMessage("");
    try {
      const result = await endLabAttempt(fetch, examAttemptId);
      if (result.kind === "pending") {
        if (result.labStatus) {
          reportLabStatusLoaded(result.labStatus);
          reportAttemptStatusChange(result.labStatus.status);
        }
        setState(getEndExamPendingLaunchState(result));
        setMessage(result.message);
        return;
      }
      if (result.kind === "blocked") {
        if (result.labStatus) {
          reportLabStatusLoaded(result.labStatus);
          reportAttemptStatusChange(result.labStatus.status);
        }
        setState(result.labStatus?.status === "suspended" ? "suspended" : "error");
        setMessage(result.message);
        return;
      }
      setState("completed");
      setMessage(result.message);
      reportAttemptStatusChange("completed");
    } catch (err) {
      setState("error");
      setMessage(err instanceof Error ? err.message : "end exam failed");
    } finally {
      actionInFlightRef.current = false;
    }
  }

  useEffect(() => {
    const target = getLauncherSyncTarget(currentAttemptStatus);
    if (target) {
      syncToAuthoritativeAttemptStatus(currentAttemptStatus);
    }
  }, [currentAttemptStatus, syncToAuthoritativeAttemptStatus]);

  useEffect(() => {
    if (state !== "open") return;

    startHeartbeat();

    // Fast-path beacon on page hide / visibility change
    const handleVisibility = () => {
      if (document.visibilityState === "hidden") {
        sendBeaconHeartbeat();
      }
    };
    const handlePageHide = () => {
      sendBeaconHeartbeat();
    };
    document.addEventListener("visibilitychange", handleVisibility);
    window.addEventListener("pagehide", handlePageHide);

    // Poll childWindow.closed — proactively suspend when the lab window closes
    childPollRef.current = setInterval(() => {
      if (!isLabWindowOpen(examAttemptId)) {
        void suspendNow();
      }
    }, CHILD_POLL_INTERVAL_MS);

    return () => {
      stopHeartbeat();
      stopChildPoll();
      document.removeEventListener("visibilitychange", handleVisibility);
      window.removeEventListener("pagehide", handlePageHide);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state]);

  const launcherPresentation = getLauncherPresentation({
    state,
    attemptStatus: launcherAttemptStatus,
    message,
    openPeriodClosed,
  });
  const recoveryAction =
    state === "error" ? getLauncherRecoveryAction(launcherAttemptStatus, openPeriodClosed) : null;
  const showEndExam =
    (launcherAttemptStatus === "in_progress" || launcherAttemptStatus === "suspended") &&
    state !== "completed" &&
    state !== "launching" &&
    state !== "suspending" &&
    state !== "ending";

  return (
    <section
      aria-label="Lab launcher"
      style={{
        border: `1px solid ${launcherPresentation.tone === "error" ? "#f5c2c7" : "#d9e2ec"}`,
        borderRadius: "8px",
        backgroundColor: launcherPresentation.tone === "error" ? "#fff5f5" : "#ffffff",
        padding: "1rem 1.1rem",
      }}
    >
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "flex-start",
          gap: "1rem",
          flexWrap: "wrap",
        }}
      >
        <div style={{ flex: "1 1 320px" }}>
          <p
            style={{
              margin: 0,
              fontSize: "0.8rem",
              fontWeight: 700,
              color: launcherPresentation.tone === "error" ? "#b42318" : "#52606d",
            }}
          >
            {launcherPresentation.tone === "error" ? "Recovery" : "Launcher status"}
          </p>
          <h2 style={{ margin: "0.35rem 0 0.45rem", fontSize: "1.1rem", color: "#14213d" }}>
            {launcherPresentation.title}
          </h2>
          <p
            role={state === "error" ? "alert" : undefined}
            style={{
              margin: 0,
              color: launcherPresentation.tone === "error" ? "#7a271a" : "#334e68",
            }}
          >
            {launcherPresentation.detail}
          </p>
          {launcherPresentation.supportMessage ? (
            <p role="note" style={{ margin: "0.75rem 0 0", color: "#52606d" }}>
              {launcherPresentation.supportMessage}
            </p>
          ) : null}
        </div>
        <div style={{ display: "flex", gap: "0.75rem", flexWrap: "wrap", alignItems: "center" }}>
          {state === "idle" && !openPeriodClosed ? (
            <button type="button" onClick={launch} style={primaryButtonStyle}>
              Enter exam
            </button>
          ) : null}
          {state === "error" && recoveryAction ? (
            <button
              type="button"
              onClick={recoveryAction.action === "resume" ? resumeNow : launch}
              style={primaryButtonStyle}
            >
              {recoveryAction.label}
            </button>
          ) : null}
          {state === "suspended" && !openPeriodClosed ? (
            <button type="button" onClick={resumeNow} style={primaryButtonStyle}>
              Resume exam
            </button>
          ) : null}
          {state === "open" && !openPeriodClosed ? (
            <button type="button" onClick={suspendNow} style={primaryButtonStyle}>
              Suspend lab
            </button>
          ) : null}
          {showEndExam ? (
            <button type="button" onClick={endNow} style={secondaryButtonStyle}>
              End exam
            </button>
          ) : null}
        </div>
      </div>
    </section>
  );
}

const primaryButtonStyle = {
  padding: "0.75rem 1rem",
  borderRadius: "8px",
  border: "1px solid #0b5d3b",
  backgroundColor: "#0b5d3b",
  color: "#ffffff",
  fontWeight: 700,
} as const;

const secondaryButtonStyle = {
  padding: "0.75rem 1rem",
  borderRadius: "8px",
  border: "1px solid #9aa5b1",
  backgroundColor: "#ffffff",
  color: "#14213d",
  fontWeight: 700,
} as const;
