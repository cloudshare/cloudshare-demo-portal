/** @vitest-environment jsdom */
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import React from "react";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SalesTrialHome } from "./sales-trial-home";

const { routerReplace, routerRefresh } = vi.hoisted(() => ({
  routerReplace: vi.fn(),
  routerRefresh: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: routerReplace, refresh: routerRefresh }),
}));

describe("Sales Trial participant home", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    cleanup();
  });

  it("shows a no-offerings state and sign-out without certification or Sales Admin content", () => {
    const html = renderToStaticMarkup(createElement(SalesTrialHome, { email: "visitor@example.test", firstName: "Ari" }));

    expect(html).toContain("There are no active Trial Offerings right now.");
    expect(html).toContain("Sign out");
    expect(html).not.toContain("Exam catalog");
    expect(html).not.toContain("Sales Sessions");
  });

  it("treats a logout 401 as signed out without creating an expiry return loop", async () => {
    const user = userEvent.setup();
    const fetchImpl = vi.fn().mockResolvedValue({ ok: false, status: 401 });

    render(
      <SalesTrialHome
        email="visitor@example.test"
        firstName="Ari"
        fetchImpl={fetchImpl as typeof fetch}
        initialOfferings={[{
          id: "offering-1",
          title: "Helios Trial",
          description: "Shared trial",
          start: "2026-08-30T09:00",
          end: "2026-08-30T17:00",
          timeZone: "UTC",
        }]}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Sign out" }));

    await waitFor(() => expect(routerReplace).toHaveBeenCalledWith("/sales-trial/login"));
    expect(routerReplace).not.toHaveBeenCalledWith("/sales-trial/login?returnTo=%2Fsales-trial");
    expect(fetchImpl).toHaveBeenCalledOnce();
    expect(fetchImpl).toHaveBeenCalledWith("/api/auth/logout", { method: "POST" });
  });

  it("renders offering cards with wrapped action layout that stays constrained-width friendly", () => {
    const view = render(
      <SalesTrialHome
        email="visitor@example.test"
        firstName="Ari"
        initialOfferings={[
          {
            id: "offering-1",
            title: "Helios Trial",
            description: "Shared trial",
            start: "2026-08-30T09:00",
            end: "2026-08-30T17:00",
            timeZone: "UTC",
          },
        ]}
      />,
    );
    const html = renderToStaticMarkup(
      createElement(SalesTrialHome, {
        email: "visitor@example.test",
        firstName: "Ari",
        initialOfferings: [
          {
            id: "offering-1",
            title: "Helios Trial",
            description: "Shared trial",
            start: "2026-08-30T09:00",
            end: "2026-08-30T17:00",
            timeZone: "UTC",
          },
        ],
      }),
    );

    expect(html).toContain("max-width:1180px");
    expect(html).toContain("Trial details");
    expect(html).toContain("grid-template-columns:repeat(auto-fit, minmax(min(100%, 18rem), 1fr))");
    expect(html).toContain("@media (prefers-reduced-motion: reduce)");
    const cardStyle = view.container.querySelector("article")?.getAttribute("style") ?? "";
    expect(cardStyle).toContain("min-height: 27rem");
    expect(cardStyle).not.toMatch(/(^|;)\s*height:\s*27rem/);
    expect(cardStyle).not.toContain("overflow: hidden");
  });

  it("opens a retained child window and focuses it on repeat entry", async () => {
    const user = userEvent.setup();
    const openTrialWindow = vi
      .fn()
      .mockReturnValueOnce({ reused: false })
      .mockReturnValueOnce({ reused: true });

    const view = render(
      <SalesTrialHome
        email="visitor@example.test"
        firstName="Ari"
        openTrialWindow={openTrialWindow}
        initialOfferings={[
          {
            id: "offering-1",
            title: "Helios Trial",
            description: "Shared trial",
            start: "2026-08-30T09:00",
            end: "2026-08-30T17:00",
            timeZone: "UTC",
          },
        ]}
      />,
    );

    await screen.findByRole("button", { name: "Open trial window" });
    await user.click(screen.getByRole("button", { name: "Open trial window" }));
    await user.click(screen.getByRole("button", { name: "Focus trial window" }));

    expect(openTrialWindow).toHaveBeenNthCalledWith(1, "offering-1");
    expect(openTrialWindow).toHaveBeenNthCalledWith(2, "offering-1");
    expect(screen.getByRole("button", { name: "Focus trial window" })).toBeTruthy();
  });

  it("flips each Trial Offering card to details and back without changing the launch action", async () => {
    const user = userEvent.setup();
    const openTrialWindow = vi.fn().mockReturnValue({ reused: false });

    render(
      <SalesTrialHome
        email="visitor@example.test"
        firstName="Ari"
        openTrialWindow={openTrialWindow}
        initialOfferings={[
          {
            id: "offering-1",
            title: "Helios Trial",
            description: "Shared trial",
            start: "2026-08-30T09:00",
            end: "2026-08-30T17:00",
            timeZone: "UTC",
          },
        ]}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Trial details" }));
    expect(screen.getByText("Window")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Back to trial" })).toBeTruthy();

    await user.click(screen.getByRole("button", { name: "Back to trial" }));
    await user.click(screen.getByRole("button", { name: "Open trial window" }));
    expect(openTrialWindow).toHaveBeenCalledWith("offering-1");
  });

  it("removes the hidden card face from keyboard tab order while the opposite face is active", async () => {
    const user = userEvent.setup();

    const view = render(
      <SalesTrialHome
        email="visitor@example.test"
        firstName="Ari"
        initialOfferings={[
          {
            id: "offering-1",
            title: "Helios Trial",
            description: "Shared trial",
            start: "2026-08-30T09:00",
            end: "2026-08-30T17:00",
            timeZone: "UTC",
          },
        ]}
      />,
    );

    const openButton = screen.getByRole("button", { name: "Open trial window" });
    const detailsButton = screen.getByRole("button", { name: "Trial details" });
    const allButtons = Array.from(view.container.querySelectorAll("button"));
    const hiddenBackButton = allButtons.find((button) => button.textContent === "Back to trial");
    const hiddenBackLaunchButton = allButtons.filter((button) => button.textContent === "Open trial window")[1];

    expect(detailsButton.getAttribute("tabindex")).toBe("0");
    expect(hiddenBackButton?.getAttribute("tabindex")).toBe("-1");
    expect(hiddenBackLaunchButton?.getAttribute("tabindex")).toBe("-1");

    await user.click(detailsButton);

    const launchButtonsAfterFlip = Array.from(view.container.querySelectorAll("button")).filter((button) => button.textContent === "Open trial window");
    const backButton = Array.from(view.container.querySelectorAll("button")).find((button) => button.textContent === "Back to trial");
    const frontLaunchButton = launchButtonsAfterFlip[0];

    expect(frontLaunchButton?.getAttribute("tabindex")).toBe("-1");
    expect(screen.getByRole("button", { name: "Open trial window" }).getAttribute("tabindex")).toBe("0");
    expect(backButton?.getAttribute("tabindex")).toBe("0");
    expect(openButton.getAttribute("tabindex")).toBe("-1");
  });

  it("shows a blocked-entry alert from the child window handoff without exposing provider data", async () => {
    const user = userEvent.setup();
    const openTrialWindow = vi.fn().mockReturnValue({ reused: false });

    render(
      <SalesTrialHome
        email="visitor@example.test"
        firstName="Ari"
        openTrialWindow={openTrialWindow}
        initialOfferings={[
          {
            id: "offering-1",
            title: "Helios Trial",
            description: "Shared trial",
            start: "2026-08-30T09:00",
            end: "2026-08-30T17:00",
            timeZone: "UTC",
          },
        ]}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Open trial window" }));

    await act(async () => {
      window.dispatchEvent(
        new MessageEvent("message", {
          origin: "http://localhost:3000",
          data: {
            type: "certalis:sales-trial-entry-blocked",
            offeringId: "offering-1",
            status: 404,
            message: "This Sales Trial launch is unavailable.",
          },
        }),
      );
    });

    await waitFor(() => {
      expect(screen.getByRole("alert").textContent).toContain(
        "This Sales Trial launch is unavailable.",
      );
    });
    expect(openTrialWindow).toHaveBeenCalledWith("offering-1");
    expect(screen.getByRole("alert").textContent).not.toContain("cloudshare.com");
  });

  it("fetches active Trial Offerings only once across render and rerender when no initial offerings are provided", async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        offerings: [
          {
            id: "offering-1",
            title: "Helios Trial",
            description: "Shared trial",
            start: "2026-08-30T09:00",
            end: "2026-08-30T17:00",
            timeZone: "UTC",
          },
        ],
      }),
    });

    const { rerender } = render(
      <SalesTrialHome
        email="visitor@example.test"
        firstName="Ari"
        fetchImpl={fetchImpl as typeof fetch}
      />,
    );

    await screen.findByRole("button", { name: "Trial details" });

    rerender(
      <SalesTrialHome
        email="visitor@example.test"
        firstName="Ari"
        fetchImpl={fetchImpl as typeof fetch}
      />,
    );

    await waitFor(() => {
      expect(fetchImpl).toHaveBeenCalledTimes(1);
    });
    expect(fetchImpl).toHaveBeenCalledWith("/api/sales-trial/offerings", {
      cache: "no-store",
    });
  });

  it("replaces the rendered participant portal after a post-render 401 without retaining its content", async () => {
    window.history.replaceState({}, "", "/sales-trial");
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: false,
      status: 401,
      json: async () => ({ error: "unauthorized" }),
    });

    render(<SalesTrialHome email="visitor@example.test" firstName="Ari" fetchImpl={fetchImpl as typeof fetch} />);

    await waitFor(() => expect(routerReplace).toHaveBeenCalledWith("/sales-trial/login?returnTo=%2Fsales-trial"));
    expect(screen.queryByText("Your Sales Trial sign-in is active")).toBeNull();
    expect(fetchImpl).toHaveBeenCalledOnce();
  });
});
