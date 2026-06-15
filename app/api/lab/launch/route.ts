import { NextResponse } from "next/server";

/**
 * Retired direct launch endpoint.
 *
 * ADR-002 requires sponsored-link URLs to stay server-only and be reached via a
 * time-gated `/enter` redirect. Keeping this legacy JSON endpoint active would
 * leak the bearer `loginUrl` and bypass the launch gate.
 */
export async function POST() {
  return NextResponse.json(
    { error: "Lab launch must use the time-gated /enter redirect." },
    { status: 410 },
  );
}
