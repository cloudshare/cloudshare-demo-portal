import { ScoreDisplay } from "@/web/score-display";

/**
 * Candidate score page. Shown after the lab session completes.
 * Renders the Guided Journey ScoreResult for the exam attempt, including
 * CloudShare's known scoring limitations surfaced inline.
 */
export default async function CandidateScorePage({
  searchParams,
}: {
  searchParams: Promise<{ examAttemptId?: string }>;
}) {
  const { examAttemptId } = await searchParams;

  if (!examAttemptId) {
    return (
      <main>
        <h1>Session complete</h1>
        <p>Missing examAttemptId.</p>
      </main>
    );
  }

  return (
    <main>
      <h1>Session complete</h1>
      <p>Exam attempt: {examAttemptId}</p>
      <ScoreDisplay examAttemptId={examAttemptId} />
    </main>
  );
}
