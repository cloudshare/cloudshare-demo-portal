import { LabLauncher } from "@/web/lab-launcher";

/**
 * Minimal candidate lab page. Reads the ExamAttempt from the query string and
 * renders the launcher. The entitlement decision is made server-side by the
 * launch route, never here.
 */
export default async function CandidateLabPage({
  searchParams,
}: {
  searchParams: Promise<{ examAttemptId?: string; attemptStatus?: string }>;
}) {
  const { examAttemptId, attemptStatus } = await searchParams;

  if (!examAttemptId) {
    return (
      <main>
        <h1>Launch lab</h1>
        <p>Missing examAttemptId.</p>
      </main>
    );
  }

  return (
    <main>
      <h1>Launch lab</h1>
      <p>Exam attempt: {examAttemptId}</p>
      <LabLauncher
        examAttemptId={examAttemptId}
        initialAttemptStatus={
          attemptStatus === "ready" ||
          attemptStatus === "in_progress" ||
          attemptStatus === "suspended"
            ? attemptStatus
            : "ready"
        }
      />
    </main>
  );
}
