/** @vitest-environment jsdom */
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import React, { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  CloudShareConnectionFeature,
  CloudShareConnectionTestWarning,
} from "./admin-cloudshare-connection";
import {
  buildAdminNavigationHref,
  type AdminNavigationIntent,
} from "./admin-shell-route";
import {
  createAdminAuthenticatedRequest,
  type AdminAuthenticatedRequest,
} from "./admin-authenticated-request";

const shellNavigationHref = (intent: AdminNavigationIntent) => buildAdminNavigationHref(intent);

function connectionResponse(
  body: Record<string, unknown>,
  status = 200,
): Response {
  return new Response(JSON.stringify(body), { status });
}

afterEach(cleanup);

describe("CloudShareConnectionFeature", () => {
  it("renders the current credential setup workflow in Configuration", () => {
    const html = renderToStaticMarkup(
      createElement(CloudShareConnectionFeature, {
        fetchAdmin: vi.fn(),
        getNavigationHref: shellNavigationHref,
        onNavigate: vi.fn(),
      }),
    );

    expect(html).toContain("Save CloudShare Connection");
    expect(html).toContain("Test connection");
    expect(html).toContain("API ID");
  });

  it("renders a failed connection test with its Support Diagnostics link", () => {
    const html = renderToStaticMarkup(
      createElement(CloudShareConnectionTestWarning, {
        warning:
          "CloudShare is returning a 429 error for the current request. This is likely CloudShare rate limiting or abuse protection blocking the request. Check whether this public IP needs CloudShare allow-list or abuse-list review before retrying by contacting support@cloudshare.com.",
        correlationId: "corr-rate-limit",
        getNavigationHref: shellNavigationHref,
      }),
    );

    expect(html).toContain("CloudShare is returning a 429 error");
    expect(html).toContain("support@cloudshare.com");
    expect(html).toContain("public IP");
    expect(html).toContain("Support Diagnostics");
    expect(html).toContain("/admin?tab=support&amp;view=diagnostics&amp;correlationId=corr-rate-limit");
  });

  it("loads and presents the saved Connection status from the existing GET endpoint", async () => {
    const fetchAdmin = vi.fn<AdminAuthenticatedRequest>().mockResolvedValue(
      connectionResponse({
        hasConnection: true,
        connectedAt: "2026-07-11T10:00:00.000Z",
        verifiedAt: "2026-07-11T10:01:00.000Z",
        webhookPath: "/api/webhooks/cloudshare/customer-token",
      }),
    );

    render(
      <CloudShareConnectionFeature
        fetchAdmin={fetchAdmin}
        getNavigationHref={shellNavigationHref}
        onNavigate={vi.fn()}
      />,
    );

    expect(await screen.findByText("Verified")).toBeTruthy();
    expect(fetchAdmin).toHaveBeenCalledWith("/api/admin/cloudshare");
    expect(screen.getByText("/api/webhooks/cloudshare/customer-token")).toBeTruthy();
  });

  it("keeps the Configuration controls usable when the initial Connection read fails", async () => {
    const fetchAdmin = vi.fn<AdminAuthenticatedRequest>().mockResolvedValue(
      connectionResponse({ error: "CloudShare status is temporarily unavailable" }, 503),
    );

    render(
      <CloudShareConnectionFeature
        fetchAdmin={fetchAdmin}
        getNavigationHref={shellNavigationHref}
        onNavigate={vi.fn()}
      />,
    );

    await waitFor(() => expect(fetchAdmin).toHaveBeenCalledWith("/api/admin/cloudshare"));
    expect(screen.getByText("No CloudShare Connection saved yet")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Save CloudShare Connection" }).hasAttribute("disabled")).toBe(false);
  });

  it("validates before saving, then sends the current credential payload and clears the inputs", async () => {
    const user = userEvent.setup();
    const fetchAdmin = vi.fn<AdminAuthenticatedRequest>()
      .mockResolvedValueOnce(connectionResponse({
        hasConnection: false,
        connectedAt: null,
        verifiedAt: null,
        webhookPath: null,
      }))
      .mockResolvedValueOnce(connectionResponse({
        hasConnection: true,
        connectedAt: "2026-07-11T10:00:00.000Z",
        verifiedAt: null,
        webhookPath: "/api/webhooks/cloudshare/customer-token",
      }));

    render(
      <CloudShareConnectionFeature
        fetchAdmin={fetchAdmin}
        getNavigationHref={shellNavigationHref}
        onNavigate={vi.fn()}
      />,
    );

    await waitFor(() => expect(fetchAdmin).toHaveBeenCalledTimes(1));
    await user.click(screen.getByRole("button", { name: "Save CloudShare Connection" }));
    expect((await screen.findByText(
      "API ID, API Key, and Webhook Secret are required to save the first CloudShare Connection.",
    )).textContent).toContain("API ID, API Key, and Webhook Secret are required to save the first CloudShare Connection.");
    expect(fetchAdmin).toHaveBeenCalledTimes(1);

    const apiIdInput = screen.getByLabelText("API ID") as HTMLInputElement;
    const apiKeyInput = screen.getByLabelText("API Key") as HTMLInputElement;
    const webhookSecretInput = screen.getByLabelText("Webhook Secret") as HTMLInputElement;
    await user.type(apiIdInput, "api-id-1");
    await user.type(apiKeyInput, "api-key-1");
    await user.type(webhookSecretInput, "webhook-secret-1");
    await user.click(screen.getByRole("button", { name: "Save CloudShare Connection" }));

    await waitFor(() => expect(fetchAdmin).toHaveBeenCalledTimes(2));
    expect(fetchAdmin.mock.calls[1]).toEqual([
      "/api/admin/cloudshare",
      {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          apiId: "api-id-1",
          apiKey: "api-key-1",
          webhookSecret: "webhook-secret-1",
        }),
      },
    ]);
    expect(await screen.findByText("CloudShare Connection saved.")).toBeTruthy();
    expect(screen.getByText("Saved, not yet verified")).toBeTruthy();
    expect(apiIdInput.value).toBe("");
    expect(apiKeyInput.value).toBe("");
    expect(webhookSecretInput.value).toBe("");
  });

  it("shows a failed test warning and sends the existing typed Support Diagnostics intent", async () => {
    const user = userEvent.setup();
    const onNavigate = vi.fn();
    const fetchAdmin = vi.fn<AdminAuthenticatedRequest>()
      .mockResolvedValueOnce(connectionResponse({
        hasConnection: true,
        connectedAt: "2026-07-11T10:00:00.000Z",
        verifiedAt: null,
        webhookPath: "/api/webhooks/cloudshare/customer-token",
      }))
      .mockResolvedValueOnce(connectionResponse({
        error: "CloudShare is returning a 429 error for the current request.",
        correlationId: "corr-rate-limit",
      }, 429));

    render(
      <CloudShareConnectionFeature
        fetchAdmin={fetchAdmin}
        getNavigationHref={shellNavigationHref}
        onNavigate={onNavigate}
      />,
    );

    expect((await screen.findByRole("button", { name: "Test connection" })).hasAttribute("disabled")).toBe(false);
    await user.click(screen.getByRole("button", { name: "Test connection" }));
    expect(await screen.findByText("CloudShare is returning a 429 error for the current request.")).toBeTruthy();
    await user.click(screen.getByRole("link", { name: "corr-rate-limit" }));

    expect(onNavigate).toHaveBeenCalledWith({
      tab: "support",
      supportView: "diagnostics",
      diagnosticFilters: { correlationId: "corr-rate-limit" },
    });
  });

  it("disables Connection controls while a test is pending, then refreshes the status after success", async () => {
    const user = userEvent.setup();
    let resolveTestResponse: (response: Response) => void = () => undefined;
    const pendingTestResponse = new Promise<Response>((resolve) => {
      resolveTestResponse = resolve;
    });
    const fetchAdmin = vi.fn<AdminAuthenticatedRequest>()
      .mockResolvedValueOnce(connectionResponse({
        hasConnection: true,
        connectedAt: "2026-07-11T10:00:00.000Z",
        verifiedAt: null,
        webhookPath: "/api/webhooks/cloudshare/customer-token",
      }))
      .mockReturnValueOnce(pendingTestResponse)
      .mockResolvedValueOnce(connectionResponse({
        hasConnection: true,
        connectedAt: "2026-07-11T10:00:00.000Z",
        verifiedAt: "2026-07-11T10:01:00.000Z",
        webhookPath: "/api/webhooks/cloudshare/customer-token",
      }));

    render(
      <CloudShareConnectionFeature
        fetchAdmin={fetchAdmin}
        getNavigationHref={shellNavigationHref}
        onNavigate={vi.fn()}
      />,
    );

    expect((await screen.findByRole("button", { name: "Test connection" })).hasAttribute("disabled")).toBe(false);
    await user.click(screen.getByRole("button", { name: "Test connection" }));
    expect(screen.getByRole("button", { name: "Testing..." }).hasAttribute("disabled")).toBe(true);
    expect(screen.getByRole("button", { name: "Saving..." }).hasAttribute("disabled")).toBe(true);

    resolveTestResponse(connectionResponse({ message: "pong", correlationId: "corr-success" }));

    expect(await screen.findByText("CloudShare responded with pong.")).toBeTruthy();
    expect(screen.getByText("Verified")).toBeTruthy();
    expect(fetchAdmin).toHaveBeenNthCalledWith(2, "/api/admin/cloudshare/test", { method: "POST" });
    expect(fetchAdmin).toHaveBeenNthCalledWith(3, "/api/admin/cloudshare");
  });

  it("delegates a 401 from the initial read to the shared session-expiry adapter", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(new Response(null, { status: 401 }));
    const onSessionExpired = vi.fn();
    const fetchAdmin = createAdminAuthenticatedRequest({ fetchImpl, onSessionExpired });

    render(
      <CloudShareConnectionFeature
        fetchAdmin={fetchAdmin}
        getNavigationHref={shellNavigationHref}
        onNavigate={vi.fn()}
      />,
    );

    await waitFor(() => expect(onSessionExpired).toHaveBeenCalledOnce());
    expect(fetchImpl).toHaveBeenCalledWith("/api/admin/cloudshare", undefined);
    expect(screen.queryByRole("alert")).toBeNull();
  });
});
