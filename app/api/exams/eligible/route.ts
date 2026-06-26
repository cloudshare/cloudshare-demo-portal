import { NextResponse } from "next/server";
import { retiredLegacySimulatorExamFlowResponse } from "@/api/legacy-simulator-routes";

/**
 * Retired simulator eligibility endpoint.
 *
 * The active Certalis/Helios candidate catalog is `GET /api/candidate/exams`.
 * Keeping this route connected to the old simulator flow exposes retired
 * lifecycle state alongside the CloudShare runtime.
 */
export async function GET() {
  return NextResponse.json(retiredLegacySimulatorExamFlowResponse, { status: 410 });
}
