"use client";

import { useRouter } from "next/navigation";
import { LabLauncher } from "./lab-launcher";

type AttemptStatus = "ready" | "in_progress" | "suspended";

export function CandidateLabShell({
  examAttemptId,
  initialAttemptStatus,
}: {
  readonly examAttemptId: string;
  readonly initialAttemptStatus: AttemptStatus;
}) {
  const router = useRouter();

  async function logout() {
    await fetch("/api/auth/logout", { method: "POST" });
    router.push("/login");
    router.refresh();
  }

  return (
    <main style={{ fontFamily: "system-ui, sans-serif", padding: "2rem", maxWidth: "720px", margin: "0 auto" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: "1rem", flexWrap: "wrap", marginBottom: "1.5rem" }}>
        <div>
          <h1 style={{ marginBottom: "0.35rem" }}>Launch lab</h1>
          <p style={{ margin: 0, color: "#555" }}>Exam attempt: {examAttemptId}</p>
        </div>
        <div style={{ display: "flex", gap: "0.75rem", flexWrap: "wrap" }}>
          <button type="button" onClick={() => router.push("/candidate")} style={{ padding: "0.55rem 0.9rem" }}>
            Back to Candidate Home
          </button>
          <button type="button" onClick={() => void logout()} style={{ padding: "0.55rem 0.9rem" }}>
            Log out
          </button>
        </div>
      </div>
      <LabLauncher
        examAttemptId={examAttemptId}
        initialAttemptStatus={initialAttemptStatus}
      />
    </main>
  );
}
