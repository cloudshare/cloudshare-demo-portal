import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { SalesWorkspace } from "./sales-workspace";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
}));

describe("SalesWorkspace", () => {
  it("server-renders the initial Sales workspace without browser globals", () => {
    const html = renderToStaticMarkup(
      createElement(SalesWorkspace, { email: "sales-admin@certalis.demo" }),
    );

    expect(html).toContain("Sales Workspace");
    expect(html).toContain("No Sales Experiences yet");
  });
});
