"use client";

import { useState, useCallback, useEffect } from "react";

// --- Types mirroring the API response ---

type StepStatus = "pending" | "available" | "done" | "stalled";

interface DemoStep {
  id: string;
  label: string;
  description: string;
  status: StepStatus;
}

interface CurrentState {
  examAttemptId: string | null;
  labLaunchId: string | null;
  loginUrl: string | null;
  environmentStatus: string | null;
  timerStatus: string | null;
  timerElapsedMs: number | null;
}

interface PanelState {
  seed: { candidateId: string; examId: string; examTitle: string };
  steps: DemoStep[];
  currentState: CurrentState;
}

interface StepResult {
  [key: string]: unknown;
}

// --- Helpers ---

function fmtMs(ms: number): string {
  const s = Math.floor(ms / 1000);
  const m = Math.floor(s / 60);
  return `${m}m ${s % 60}s`;
}

const STATUS_COLOR: Record<StepStatus, string> = {
  pending: "#aaa",
  available: "#0070f3",
  done: "#22c55e",
  stalled: "#d97706",
};

const STATUS_BG: Record<StepStatus, string> = {
  pending: "#f5f5f5",
  available: "#eff6ff",
  done: "#f0fdf4",
  stalled: "#fffbeb",
};

// --- Component ---

export default function DemoControlPage() {
  const [panel, setPanel] = useState<PanelState | null>(null);
  const [stepResults, setStepResults] = useState<Record<string, StepResult>>({});
  const [stepErrors, setStepErrors] = useState<Record<string, string>>({});
  const [running, setRunning] = useState<string | null>(null); // step id being executed
  const [autoPlaying, setAutoPlaying] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadState = useCallback(async () => {
    try {
      const res = await fetch("/api/demo/state");
      const data = (await res.json()) as PanelState;
      setPanel(data);
      setError(null);
    } catch {
      setError("Failed to load demo state");
    }
  }, []);

  useEffect(() => {
    void loadState();
  }, [loadState]);

  async function executeStep(stepId: string) {
    setRunning(stepId);
    setStepErrors((prev) => ({ ...prev, [stepId]: "" }));
    try {
      const res = await fetch("/api/demo/step", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ step: stepId }),
      });
      const data = (await res.json()) as { ok: boolean; result?: StepResult; error?: string };
      if (!res.ok || !data.ok) {
        setStepErrors((prev) => ({
          ...prev,
          [stepId]: data.error ?? `Step failed (${res.status})`,
        }));
      } else {
        setStepResults((prev) => ({ ...prev, [stepId]: data.result ?? {} }));
      }
    } catch {
      setStepErrors((prev) => ({ ...prev, [stepId]: "Network error" }));
    } finally {
      setRunning(null);
      await loadState();
    }
  }

  async function resetDemo() {
    setRunning("__reset__");
    setStepResults({});
    setStepErrors({});
    setAutoPlaying(false);
    try {
      await fetch("/api/demo/reset", { method: "POST" });
    } finally {
      setRunning(null);
      await loadState();
    }
  }

  async function autoPlay() {
    setAutoPlaying(true);
    try {
      while (true) {
        const res = await fetch("/api/demo/state");
        const fresh = (await res.json()) as PanelState;
        setPanel(fresh);
        const nextStep = fresh.steps.find((s) => s.status === "available");
        if (!nextStep) break;
        await executeStep(nextStep.id);
        // small pause between steps so the state update is visible
        await new Promise((r) => setTimeout(r, 300));
      }
    } finally {
      setAutoPlaying(false);
    }
  }

  const allDone = panel?.steps.every((s) => s.status === "done") ?? false;
  const anyAvailable = panel?.steps.some((s) => s.status === "available") ?? false;

  return (
    <main
      style={{
        fontFamily: "monospace",
        padding: "2rem",
        maxWidth: "860px",
        margin: "0 auto",
      }}
    >
      <div style={{ display: "flex", alignItems: "baseline", gap: "1rem", marginBottom: "1.5rem" }}>
        <h1 style={{ margin: 0 }}>Demo Control Panel</h1>
        {panel && (
          <span style={{ fontSize: "0.85rem", color: "#555" }}>
            {panel.seed.examTitle} · candidate{" "}
            <code>{panel.seed.candidateId}</code>
          </span>
        )}
      </div>

      {error && (
        <p
          style={{
            background: "#fff0f0",
            color: "#c00",
            padding: "0.5rem",
            borderRadius: "4px",
            marginBottom: "1rem",
          }}
        >
          {error}
        </p>
      )}

      {/* Toolbar */}
      <div
        style={{
          display: "flex",
          gap: "0.75rem",
          marginBottom: "1.5rem",
          alignItems: "center",
        }}
      >
        <button
          onClick={() => void autoPlay()}
          disabled={autoPlaying || !anyAvailable || allDone || running !== null}
          style={btnStyle(autoPlaying || !anyAvailable || allDone || running !== null, "#0070f3")}
        >
          {autoPlaying ? "Running…" : "▶ Auto-play"}
        </button>
        <button
          onClick={() => void resetDemo()}
          disabled={running !== null}
          style={btnStyle(running !== null, "#e44")}
        >
          {running === "__reset__" ? "Resetting…" : "↺ Reset"}
        </button>
        <button
          onClick={() => void loadState()}
          disabled={running !== null}
          style={btnStyle(running !== null, "#555")}
        >
          ⟳ Refresh
        </button>
        {allDone && (
          <span style={{ color: "#22c55e", fontWeight: "bold" }}>
            ✓ Happy path complete!
          </span>
        )}
      </div>

      {/* Steps */}
      {panel && (
        <ol style={{ listStyle: "none", padding: 0, margin: 0 }}>
          {panel.steps.map((step) => {
            const isRunning = running === step.id;
            const result = stepResults[step.id];
            const stepErr = stepErrors[step.id];
            return (
              <li
                key={step.id}
                style={{
                  background: STATUS_BG[step.status],
                  border: `1px solid ${STATUS_COLOR[step.status]}`,
                  borderRadius: "6px",
                  padding: "1rem 1.25rem",
                  marginBottom: "0.75rem",
                  opacity: step.status === "pending" ? 0.55 : 1,
                  transition: "opacity 0.2s, background 0.2s",
                }}
              >
                <div
                  style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}
                >
                  <div>
                    <span
                      style={{
                        fontWeight: "bold",
                        color: STATUS_COLOR[step.status],
                        marginRight: "0.5rem",
                      }}
                    >
                      {step.status === "done"
                        ? "✓"
                        : step.status === "available"
                          ? "→"
                          : step.status === "stalled"
                            ? "!"
                            : "○"}
                    </span>
                    <strong>{step.label}</strong>
                    <span style={{ color: "#555", marginLeft: "0.5rem", fontSize: "0.85rem" }}>
                      {step.description}
                    </span>
                  </div>
                  {step.status === "available" && (
                    <button
                      onClick={() => void executeStep(step.id)}
                      disabled={isRunning || running !== null || autoPlaying}
                      style={btnStyle(isRunning || running !== null || autoPlaying, "#0070f3")}
                    >
                      {isRunning ? "Running…" : "Run"}
                    </button>
                  )}
                </div>

                {/* Step result inline */}
                {result && (
                  <pre
                    style={{
                      margin: "0.5rem 0 0",
                      fontSize: "0.78rem",
                      background: "#f0fdf4",
                      padding: "0.4rem 0.6rem",
                      borderRadius: "4px",
                      overflowX: "auto",
                    }}
                  >
                    {JSON.stringify(result, null, 2)}
                  </pre>
                )}
                {stepErr && (
                  <p
                    style={{
                      margin: "0.4rem 0 0",
                      color: "#c00",
                      fontSize: "0.85rem",
                    }}
                  >
                    {stepErr}
                  </p>
                )}
              </li>
            );
          })}
        </ol>
      )}

      {/* Current domain state */}
      {panel && (
        <section
          style={{
            marginTop: "2rem",
            background: "#f8f8f8",
            border: "1px solid #ddd",
            borderRadius: "6px",
            padding: "1rem 1.25rem",
          }}
        >
          <h2 style={{ margin: "0 0 0.75rem", fontSize: "1rem" }}>Domain State</h2>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.85rem" }}>
            <tbody>
              {[
                ["ExamAttempt ID", panel.currentState.examAttemptId ?? "—"],
                ["LabLaunch ID", panel.currentState.labLaunchId ?? "—"],
                ["Environment", panel.currentState.environmentStatus ?? "—"],
                ["Timer", panel.currentState.timerStatus ?? "—"],
                [
                  "Elapsed",
                  panel.currentState.timerElapsedMs !== null
                    ? fmtMs(panel.currentState.timerElapsedMs)
                    : "—",
                ],
                [
                  "Login URL",
                  panel.currentState.loginUrl ? (
                    <a
                      href={panel.currentState.loginUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      style={{ color: "#0070f3" }}
                    >
                      open
                    </a>
                  ) : (
                    "—"
                  ),
                ],
              ].map(([label, val]) => (
                <tr
                  key={String(label)}
                  style={{ borderBottom: "1px solid #eee" }}
                >
                  <td
                    style={{
                      padding: "0.3rem 0.5rem",
                      color: "#555",
                      whiteSpace: "nowrap",
                      width: "140px",
                    }}
                  >
                    {label}
                  </td>
                  <td style={{ padding: "0.3rem 0.5rem", fontFamily: "monospace" }}>
                    {val}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}
    </main>
  );
}

function btnStyle(disabled: boolean, color: string): React.CSSProperties {
  return {
    padding: "0.4rem 1rem",
    background: disabled ? "#ccc" : color,
    color: "#fff",
    border: "none",
    borderRadius: "4px",
    cursor: disabled ? "not-allowed" : "pointer",
    fontSize: "0.85rem",
    fontFamily: "monospace",
    opacity: disabled ? 0.7 : 1,
  };
}
