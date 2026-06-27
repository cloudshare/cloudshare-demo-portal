import { NextResponse } from "next/server";
import { getServices } from "@/composition";
import {
  buildCandidateRegistrationDeps,
  handleCandidateSelfRegistration,
} from "@/api/candidate-portal";

export async function POST(request: Request) {
  const services = getServices();
  await services.ensurePortalSeeded();

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
  }

  const response = await handleCandidateSelfRegistration(
    buildCandidateRegistrationDeps(services),
    { body },
  );

  return NextResponse.json(response.body, { status: response.status });
}
