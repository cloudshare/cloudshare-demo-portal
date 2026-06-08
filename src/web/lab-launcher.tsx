"use client";

import { useState } from "react";
import { openLabWindow, setLabEnvironmentId } from "./lab-window";

type LaunchState = "idle" | "launching" | "open" | "error";

/**
 * Candidate-facing control that launches the lab. It POSTs to the launch route
 * (which performs the entitlement-gated provisioning server-side), then opens the
 * returned loginUrl in a child window whose handle is retained for liveness checks.
 * The `environmentExternalId` is also stored so Slice 8 heartbeat/liveness code
 * can correlate the window with its CloudShare environment without a round-trip.
 */
export function LabLauncher({ examAttemptId }: { examAttemptId: string }) {
  const [state, setState] = useState<LaunchState>("idle");
  const [message, setMessage] = useState<string>("");

  async function launch() {
    setState("launching");
    setMessage("");
    try {
      const response = await fetch("/api/lab/launch", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ examAttemptId }),
      });
      if (!response.ok) {
        const detail = (await response.json().catch(() => ({}))) as { error?: string };
        throw new Error(detail.error ?? `launch failed (${response.status})`);
      }
      const { loginUrl, environmentExternalId } = (await response.json()) as {
        loginUrl: string;
        environmentExternalId: string;
      };
      openLabWindow(examAttemptId, loginUrl);
      setLabEnvironmentId(examAttemptId, environmentExternalId);
      setState("open");
    } catch (err) {
      setState("error");
      setMessage(err instanceof Error ? err.message : "launch failed");
    }
  }

  return (
    <div>
      <button type="button" onClick={launch} disabled={state === "launching"}>
        {state === "launching" ? "Launching…" : "Launch lab"}
      </button>
      {state === "open" && <p>Lab opened in a new window.</p>}
      {state === "error" && <p role="alert">Could not launch the lab: {message}</p>}
    </div>
  );
}
