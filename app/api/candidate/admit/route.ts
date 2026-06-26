import { NextResponse } from "next/server";
import { retiredLegacyTokenCandidateAdmissionResponse } from "@/api/legacy-simulator-routes";

/**
 * Retired token-based Candidate admission endpoint.
 *
 * Active Candidates use the shared portal auth flow:
 * `POST /api/auth/login` -> `portal_session` -> `/api/candidate/exams`.
 */
export async function POST(_request: Request) {
  return NextResponse.json(retiredLegacyTokenCandidateAdmissionResponse, {
    status: 410,
  });
}
