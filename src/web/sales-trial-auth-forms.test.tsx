/** @vitest-environment jsdom */
import React from "react";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SalesTrialLoginForm } from "../../app/sales-trial/login/login-form";
import { SalesTrialRegisterForm } from "../../app/sales-trial/register/register-form";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("Sales Trial authentication forms", () => {
  it("submits registration through the typed route and renders the ordinary safe failure", async () => {
    const user = userEvent.setup();
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ error: "Registration is unavailable." }), {
        status: 400,
        headers: { "content-type": "application/json" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);
    render(<SalesTrialRegisterForm />);

    await user.type(screen.getByRole("textbox", { name: "First name" }), "Ari");
    await user.type(screen.getByRole("textbox", { name: "Last name" }), "Visitor");
    await user.type(screen.getByRole("textbox", { name: "Email" }), "visitor@example.test");
    await user.type(screen.getByLabelText("Password"), "safe-password");
    await user.click(screen.getByRole("button", { name: "Create account" }));

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/sales-trial/register",
      expect.objectContaining({ method: "POST" }),
    );
    expect(await screen.findByText("Registration is unavailable.")).not.toBeNull();
  });

  it("submits Sales Trial sign-in and keeps invalid credentials in the participant surface", async () => {
    const user = userEvent.setup();
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ error: "Invalid email or password" }), {
        status: 401,
        headers: { "content-type": "application/json" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);
    render(<SalesTrialLoginForm initialEmail="" initialError={null} />);

    await user.type(screen.getByRole("textbox", { name: "Email" }), "visitor@example.test");
    await user.type(screen.getByLabelText("Password"), "wrong-password");
    await user.click(screen.getByRole("button", { name: "Sign in" }));

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/sales-trial/login",
      expect.objectContaining({ method: "POST" }),
    );
    expect(await screen.findByText("Invalid email or password")).not.toBeNull();
    expect(screen.queryByText("Sales Sessions")).toBeNull();
  });
});
