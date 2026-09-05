/** @vitest-environment jsdom */
import React from "react";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { LoginForm } from "../../app/login/login-form";

afterEach(cleanup);

describe("portal login registration paths", () => {
  it("offers separate Certification and Sales Trial account paths", () => {
    render(<LoginForm initialError={null} initialEmail="" />);

    expect(screen.getByRole("link", { name: "Certification demo" }).getAttribute("href")).toBe(
      "/register",
    );
    expect(screen.getByRole("link", { name: "Sales Trial demo" }).getAttribute("href")).toBe(
      "/sales-trial/register",
    );
  });

  it("replaces history with the server redirect after successful sign-in", async () => {
    const user = userEvent.setup();
    const replace = vi.fn();
    vi.stubGlobal("location", { replace });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ redirectTo: "/candidate?returnTo=%2Flab" }), { status: 200 }),
    ));
    render(<LoginForm initialError={null} initialEmail="" returnTo="/lab" />);
    await user.type(screen.getByRole("textbox", { name: "Email" }), "candidate@example.test");
    await user.type(screen.getByLabelText("Password"), "safe-password");
    await user.click(screen.getByRole("button", { name: "Sign in" }));
    expect(replace).toHaveBeenCalledWith("/candidate?returnTo=%2Flab");
  });
});
