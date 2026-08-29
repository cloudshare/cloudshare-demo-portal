import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { SalesTrialHome } from "./sales-trial-home";

vi.mock("next/navigation", () => ({ useRouter: () => ({ replace: vi.fn(), refresh: vi.fn() }) }));

describe("Sales Trial participant home", () => {
  it("shows a no-offerings state and sign-out without certification or Sales Admin content", () => {
    const html = renderToStaticMarkup(createElement(SalesTrialHome, { email: "visitor@example.test", firstName: "Ari" }));

    expect(html).toContain("There are no active Trial Offerings right now.");
    expect(html).toContain("Sign out");
    expect(html).not.toContain("Exam catalog");
    expect(html).not.toContain("Sales Sessions");
  });
});
