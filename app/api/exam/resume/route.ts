import { NextResponse } from "next/server";

/**
 * Retired unsafe resume endpoint.
 *
 * Resume still requires a fresh sponsored link. ADR-002 forbids exposing that
 * bearer credential in client-facing JSON, so this direct route stays retired
 * until resume is reworked around the portal-owned `/enter` redirect.
 */
export async function POST() {
  return NextResponse.json(
    { error: "Exam resume must use the time-gated /enter redirect." },
    { status: 410 },
  );
}
