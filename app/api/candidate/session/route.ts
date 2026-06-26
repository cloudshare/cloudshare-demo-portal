import { NextResponse } from "next/server";
import { retiredLegacyTokenCandidateAdmissionResponse } from "@/api/legacy-simulator-routes";

/**
 * Retired token-session resume endpoint.
 *
 * Active Candidates use `GET /api/auth/session` with the shared portal session.
 */
export async function GET() {
  return NextResponse.json(retiredLegacyTokenCandidateAdmissionResponse, {
    status: 410,
  });
}
