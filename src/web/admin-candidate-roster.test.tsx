/** @vitest-environment jsdom */
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import React from "react";
import { describe, expect, it, vi } from "vitest";
import { AdminCandidateRosterFeature } from "./admin-candidate-roster";
import type { AdminAuthenticatedRequest } from "./admin-authenticated-request";

const candidate = {
  id: "candidate-1",
  email: "casey@helioscx.demo",
  firstName: "Casey",
  lastName: "Rivera",
  name: "Casey Rivera",
  createdAt: "2026-06-18T09:00:00.000Z",
  attemptSummary: { scheduled: 1, ready: 0, inProgress: 0, suspended: 0, completed: 1, expired: 0, total: 2 },
  latestAttempt: null,
  latestScore: { scoreAvailable: true, percentComplete: 82, stepsCompleted: 9, stepsTotal: 11, retrievedAt: "2026-06-19T11:05:00.000Z" },
  attempts: [{
    id: "attempt-1",
    examId: "exam-1",
    examTitle: "Helios Cloud Admin",
    status: "completed" as const,
    scheduledFor: "2026-06-19T10:00:00.000Z",
    createdAt: "2026-06-18T10:00:00.000Z",
    updatedAt: "2026-06-19T11:00:00.000Z",
    completedAt: "2026-06-19T11:00:00.000Z",
    scoreRetrievalEnabled: true,
    score: { scoreAvailable: true, percentComplete: 82, stepsCompleted: 9, stepsTotal: 11, retrievedAt: "2026-06-19T11:05:00.000Z" },
  }],
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

describe("AdminCandidateRosterFeature", () => {
  it("loads, searches, and opens Candidate ExamAttempt history through the Candidate API", async () => {
    const user = userEvent.setup();
    const fetchAdmin = vi.fn<AdminAuthenticatedRequest>(async (input) => {
      const url = String(input);
      if (url === "/api/admin/candidates" || url === "/api/admin/candidates?search=casey") {
        return json({ candidates: [candidate] });
      }
      if (url === "/api/admin/candidates/candidate-1") return json({ candidate });
      throw new Error(`Unexpected request: ${url}`);
    });

    render(<AdminCandidateRosterFeature active fetchAdmin={fetchAdmin} />);

    expect(await screen.findByText("Casey Rivera")).toBeTruthy();
    await user.type(screen.getByRole("textbox", { name: "Search candidates" }), "casey");
    await user.click(screen.getByRole("button", { name: "Search Candidates" }));
    await user.click(await screen.findByRole("button", { name: "View History" }));

    expect(await screen.findByRole("region", { name: "Candidate exam history" })).toBeTruthy();
    expect(screen.getByText("attempt-1")).toBeTruthy();
    expect(screen.getAllByText("82% (9/11 steps)")).toHaveLength(2);
    expect(fetchAdmin).toHaveBeenCalledWith("/api/admin/candidates?search=casey");
    expect(fetchAdmin).toHaveBeenCalledWith("/api/admin/candidates/candidate-1");
  });

  it("provisions a Candidate using the unchanged contract and refreshes the roster", async () => {
    const user = userEvent.setup();
    const fetchAdmin = vi.fn<AdminAuthenticatedRequest>(async (input, init) => {
      const url = String(input);
      if (url === "/api/admin/candidates" && init?.method === "POST") return json({});
      if (url === "/api/admin/candidates") return json({ candidates: [candidate] });
      throw new Error(`Unexpected request: ${url}`);
    });

    render(<AdminCandidateRosterFeature active fetchAdmin={fetchAdmin} />);
    await screen.findByText("Casey Rivera");
    await user.type(screen.getByRole("textbox", { name: "First name" }), "Taylor");
    await user.type(screen.getByRole("textbox", { name: "Last name" }), "Ng");
    await user.type(screen.getByRole("textbox", { name: "Candidate email" }), "taylor@helioscx.demo");
    await user.type(screen.getByLabelText("Temporary password"), "not-a-real-password");
    await user.click(screen.getByRole("button", { name: "Create Candidate" }));

    await waitFor(() => expect(screen.getByText("Candidate account created.")).toBeTruthy());
    expect(fetchAdmin).toHaveBeenCalledWith("/api/admin/candidates", expect.objectContaining({
      method: "POST",
      body: JSON.stringify({
        firstName: "Taylor",
        lastName: "Ng",
        email: "taylor@helioscx.demo",
        password: "not-a-real-password",
      }),
    }));
    expect((screen.getByRole("textbox", { name: "First name" }) as HTMLInputElement).value).toBe("");
  });

  it("keeps Candidate loading failures local to the feature", async () => {
    const fetchAdmin = vi.fn<AdminAuthenticatedRequest>().mockResolvedValue(json({ error: "Roster unavailable" }, 503));
    render(<AdminCandidateRosterFeature active fetchAdmin={fetchAdmin} />);

    expect(await screen.findByText("Roster unavailable")).toBeTruthy();
    expect(screen.getByText("No roster loaded.")).toBeTruthy();
  });
});
