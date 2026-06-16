"use client";

import { useState, useEffect, useRef } from "react";
import { openEnterExamWindow } from "./enter-exam";
import { isLabWindowOpen } from "./lab-window";

type LaunchState = "idle" | "launching" | "open" | "suspending" | "suspended" | "error";
type AttemptStatus = "ready" | "in_progress" | "suspended";

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
  initialAttemptStatus = "ready",
}: {
  examAttemptId: string;
  initialAttemptStatus?: AttemptStatus;
}) {
  const [state, setState] = useState<LaunchState>(
    initialAttemptStatus === "suspended" ? "suspended" : "idle",
  );
  const [message, setMessage] = useState<string>("");
  const heartbeatRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const childPollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  function sendHeartbeat() {
    fetch("/api/heartbeat", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ examAttemptId }),
    }).catch(() => {
      // best-effort; server timeout is the reliable backstop
    });
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
    sendHeartbeat();
    heartbeatRef.current = setInterval(sendHeartbeat, HEARTBEAT_INTERVAL_MS);
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
    stopHeartbeat();
    stopChildPoll();
    setState("suspending");
    try {
      const resp = await fetch("/api/exam/suspend", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ examAttemptId }),
      });
      if (!resp.ok) {
        const detail = (await resp.json().catch(() => ({}))) as { error?: string };
        throw new Error(detail.error ?? `suspend failed (${resp.status})`);
      }
      setState("suspended");
      setMessage("Lab suspended. You can resume your session when ready.");
    } catch (err) {
      setState("error");
      setMessage(err instanceof Error ? err.message : "suspend failed");
    }
  }

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

  async function launch() {
    try {
      setState("launching");
      setMessage("");
      openEnterExamWindow(examAttemptId);
      setState("open");
    } catch (err) {
      setState("error");
      setMessage(err instanceof Error ? err.message : "launch failed");
    }
  }

  async function resumeNow() {
    try {
      setState("launching");
      setMessage("");
      const resp = await fetch("/api/exam/resume", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ examAttemptId }),
      });
      if (!resp.ok) {
        const detail = (await resp.json().catch(() => ({}))) as { error?: string };
        throw new Error(detail.error ?? `resume failed (${resp.status})`);
      }
      openEnterExamWindow(examAttemptId);
      setState("open");
    } catch (err) {
      setState("error");
      setMessage(err instanceof Error ? err.message : "resume failed");
    }
  }

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

      {state === "error" && (
        <p role="alert">Error: {message}</p>
      )}
    </div>
  );
}
