import { NextResponse } from "next/server";
import { getServices } from "@/composition";
import {
  buildCandidateRegistrationDeps,
  handleCandidateSelfRegistration,
} from "@/api/candidate-portal";

export async function POST(request: Request) {
  const services = getServices();
  await services.ensurePortalSeeded();

  const contentType = request.headers.get("content-type") ?? "";
  const expectsJson = contentType.includes("application/json");

  let body: unknown;
  if (expectsJson) {
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
    }
  } else {
    const formData = await request.formData();
    body = {
      firstName: formData.get("firstName"),
      lastName: formData.get("lastName"),
      email: formData.get("email"),
      password: formData.get("password"),
    };
  }

  const response = await handleCandidateSelfRegistration(
    buildCandidateRegistrationDeps(services),
    { body },
  );

  if (!expectsJson) {
    const redirectUrl = new URL(
      response.status === 201 ? "/login" : "/register",
      request.url,
    );
    if (response.status !== 201) {
      const error =
        typeof response.body.error === "string" ? response.body.error : "Registration failed";
      redirectUrl.searchParams.set("error", error);
    }
    return NextResponse.redirect(redirectUrl, { status: 303 });
  }

  return NextResponse.json(response.body, { status: response.status });
}
