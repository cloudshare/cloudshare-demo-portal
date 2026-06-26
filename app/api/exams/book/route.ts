import { NextResponse } from "next/server";
import { retiredLegacySimulatorExamFlowResponse } from "@/api/legacy-simulator-routes";

/**
 * Retired simulator booking endpoint.
 *
 * The active Certalis/Helios scheduling flow is `POST /api/candidate/exams`.
 * Keeping this route connected to `bookExam` would keep the old simulator
 * lifecycle candidate-facing.
 */
export async function POST() {
  return NextResponse.json(retiredLegacySimulatorExamFlowResponse, { status: 410 });
}
