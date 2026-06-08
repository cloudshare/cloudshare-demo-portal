import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { getServices } from "@/composition";
import { bookExam } from "@/domain/booking";
import { NotEligibleError } from "@/domain/errors";

/**
 * Self-service exam booking — no admin step. Creates an ExamAttempt for an exam
 * the candidate is eligible for and emits the exam_attempt.created event. Returns
 * 403 if the candidate is not eligible.
 */
export async function POST(request: Request) {
  const { genesys, examAttempts, events, logger } = getServices();

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
  }
  if (typeof body !== "object" || body === null) {
    return NextResponse.json({ error: "invalid request body" }, { status: 400 });
  }

  const { candidateId, examId } = body as { candidateId?: unknown; examId?: unknown };
  if (typeof candidateId !== "string" || typeof examId !== "string") {
    return NextResponse.json(
      { error: "candidateId and examId are required" },
      { status: 400 },
    );
  }

  try {
    const attempt = await bookExam(
      {
        eligibility: genesys,
        attempts: examAttempts,
        events,
        newId: () => randomUUID(),
        now: () => new Date(),
      },
      { candidateId, examId },
    );
    logger.info("exam booked", { examAttemptId: attempt.id, examId });
    return NextResponse.json(attempt, { status: 201 });
  } catch (err) {
    if (err instanceof NotEligibleError) {
      return NextResponse.json({ error: "not eligible for this exam" }, { status: 403 });
    }
    logger.error("exam booking failed", {
      error: err instanceof Error ? err.message : String(err),
    });
    return NextResponse.json({ error: "internal error" }, { status: 500 });
  }
}
