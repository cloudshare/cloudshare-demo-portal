"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { openEnterExamWindow } from "./enter-exam";
import { isLabWindowOpen } from "./lab-window";
import { preflightLabAction, resumeLabAttempt, suspendLabAttempt, type CandidateLabStatus, type AttemptStatus } from "./lab-launcher-client";
import { getLauncherSyncTarget, type LaunchState } from "./lab-launcher-state";

const HEARTBEAT_INTERVAL_MS = 15_000;
const CHILD_POLL_INTERVAL_MS = 3_000;

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
  onAttemptStatusChange,
  onLabStatusLoaded,
}: {
  examAttemptId: string;
  currentAttemptStatus?: AttemptStatus;
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
  const heartbeatRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const childPollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const lastReportedAttemptStatusRef = useRef<AttemptStatus | null>(null);
  const currentAttemptStatusRef = useRef(currentAttemptStatus);
  const onAttemptStatusChangeRef = useRef(onAttemptStatusChange);
  const onLabStatusLoadedRef = useRef(onLabStatusLoaded);

  useEffect(() => {
    currentAttemptStatusRef.current = currentAttemptStatus;
  }, [currentAttemptStatus]);

  useEffect(() => {
    onAttemptStatusChangeRef.current = onAttemptStatusChange;
  }, [onAttemptStatusChange]);

  useEffect(() => {
    onLabStatusLoadedRef.current = onLabStatusLoaded;
  }, [onLabStatusLoaded]);

  const reportAttemptStatusChange = useCallback((status: AttemptStatus) => {
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
    const body = (await response.json().catch(() => ({}))) as { attemptStatus?: AttemptStatus };
    if (body.attemptStatus === "completed") {
      syncToAuthoritativeAttemptStatus("completed");
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
    if (currentAttemptStatusRef.current === "completed") {
      setState("completed");
      setMessage("Examination complete.");
      return;
    }
    stopHeartbeat();
    stopChildPoll();
    setState("suspending");
    try {
      const result = await suspendLabAttempt(fetch, examAttemptId);
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
    }
  }

  async function launch() {
    if (currentAttemptStatusRef.current === "completed") {
      setState("completed");
      setMessage("Examination complete.");
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
      reportAttemptStatusChange("in_progress");
      openEnterExamWindow(examAttemptId);
      setState("open");
    } catch (err) {
      setState("error");
      setMessage(err instanceof Error ? err.message : "launch failed");
    }
  }

  async function resumeNow() {
    if (currentAttemptStatusRef.current === "completed") {
      setState("completed");
      setMessage("Examination complete.");
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
      reportAttemptStatusChange("in_progress");
      openEnterExamWindow(examAttemptId);
      setState("open");
    } catch (err) {
      setState("error");
      setMessage(err instanceof Error ? err.message : "resume failed");
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

  return (
    <div>
      {(state === "idle" || state === "error") && (
        <button type="button" onClick={launch}>
          Enter exam
        </button>
      )}
      {state === "suspended" && (
        <button type="button" onClick={resumeNow}>
          Resume exam
        </button>
      )}
      {state === "launching" && <p>Opening exam…</p>}

      {state === "open" && (
        <>
          <p>Lab opened in a new window.</p>
          <p role="note">
            Leaving or closing this page without suspending keeps your lab running
            and consuming time. Use the Suspend button to pause when stepping away.
          </p>
          <button type="button" onClick={suspendNow}>
            Suspend lab
          </button>
        </>
      )}

      {state === "suspending" && <p>Suspending lab…</p>}

      {state === "suspended" && (
        <p>{message || "Lab suspended."}</p>
      )}

      {state === "completed" && (
        <p>{message || "Examination complete."}</p>
      )}

      {state === "error" && (
        <p role="alert">Error: {message}</p>
      )}
    </div>
  );
}
