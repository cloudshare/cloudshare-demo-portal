// @vitest-environment jsdom
import React from "react";
import { render, screen, fireEvent, cleanup, act } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { SalesTrialRdp } from "./sales-trial-rdp";
afterEach(cleanup);
it("checks available desktops on explicit action and uses native attachment links", async () => {
 const fetchImpl = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ state: "ready", machines: [{ name: "Windows one", selector: "opaque-one", state: "ready" }, { name: "Windows two", selector: "opaque-two", state: "preparing" }] }) });
 render(<SalesTrialRdp offeringId="offering" fetchImpl={fetchImpl} />);
 expect(fetchImpl).not.toHaveBeenCalled();
 fireEvent.click(screen.getByRole("button", { name: "Check remote desktops" }));
 const link = await screen.findByRole("link", { name: "Download RDP for Windows one" });
 expect(link.getAttribute("href")).toBe("/api/sales-trial/offerings/offering/rdp/opaque-one");
 expect(link.hasAttribute("download")).toBe(true);
 expect(screen.getByText(/Windows two.*preparing/i)).toBeTruthy();
 expect(fetchImpl).toHaveBeenCalledTimes(1);
});
it("reports an unavailable response without rendering a raw provider error", async () => {
 const fetchImpl = vi.fn().mockResolvedValue({ ok: false, json: async () => ({ password: "never-render" }) });
 render(<SalesTrialRdp offeringId="offering" fetchImpl={fetchImpl} />);
 fireEvent.click(screen.getByRole("button", { name: "Check remote desktops" }));
 expect(await screen.findByText(/You can still open the trial window/)).toBeTruthy();
 expect(screen.queryByText(/never-render/)).toBeNull();
 expect(screen.queryByRole("link")).toBeNull();
});

it("retrieves credentials deliberately, masks both fields, copies explicitly and discards on Hide", async () => {
 const copy = vi.fn().mockResolvedValue(undefined);
 Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText: copy } });
 const fetchImpl = vi.fn().mockResolvedValueOnce({ ok: true, json: async () => ({ state: "ready", machines: [{ name: "Windows one", selector: "opaque-one", state: "ready" }] }) }).mockResolvedValue({ ok: true, json: async () => ({ username: "guest-user", password: "guest-secret" }) });
 render(<SalesTrialRdp offeringId="offering" fetchImpl={fetchImpl} />);
 fireEvent.click(screen.getByRole("button", { name: "Check remote desktops" }));
 fireEvent.click(await screen.findByRole("button", { name: "Show credentials for Windows one" }));
 const username = await screen.findByLabelText("Guest username");
 expect(username.getAttribute("type")).toBe("password");
 expect(screen.getByLabelText("Guest password").getAttribute("type")).toBe("password");
 expect(fetchImpl).toHaveBeenLastCalledWith("/api/sales-trial/offerings/offering/rdp/opaque-one/credentials", { method: "POST", cache: "no-store" });
 fireEvent.click(screen.getByRole("button", { name: "Copy password" }));
 expect(copy).toHaveBeenCalledWith("guest-secret");
 fireEvent.click(screen.getByRole("button", { name: "Show password" }));
 expect(screen.getByLabelText("Guest password").getAttribute("type")).toBe("text");
 fireEvent.click(screen.getByRole("button", { name: "Hide password" }));
 expect(screen.queryByLabelText("Guest password")).toBeNull();
 fireEvent.click(screen.getByRole("button", { name: "Show credentials for Windows one" }));
 await screen.findByLabelText("Guest username");
 expect(fetchImpl).toHaveBeenCalledTimes(3);
});

it.each(["dismiss", "pagehide", "unmount"])("discards a late credential response after %s", async action => {
 let resolve: (value: unknown) => void = () => undefined;
 const pending = new Promise(done => { resolve = done; });
 const fetchImpl = vi.fn().mockResolvedValueOnce({ ok: true, json: async () => ({ state: "ready", machines: [{ name: "Windows one", selector: "opaque-one", state: "ready" }] }) }).mockReturnValueOnce(pending);
 const view = render(<SalesTrialRdp offeringId="offering" fetchImpl={fetchImpl} />);
 fireEvent.click(screen.getByRole("button", { name: "Check remote desktops" }));
 fireEvent.click(await screen.findByRole("button", { name: "Show credentials for Windows one" }));
 if (action === "dismiss") fireEvent.click(screen.getByRole("button", { name: "Dismiss credentials" }));
 if (action === "pagehide") act(() => window.dispatchEvent(new Event("pagehide")));
 if (action === "unmount") view.unmount();
 await act(async () => { resolve({ ok: true, json: async () => ({ username: "late-user", password: "late-secret" }) }); });
 expect(screen.queryByLabelText("Guest password")).toBeNull();
 expect(document.body.innerHTML).not.toMatch(/late-user|late-secret/);
});
it("never displays a credential failure body and leaves the download link usable", async () => {
 const fetchImpl = vi.fn().mockResolvedValueOnce({ ok: true, json: async () => ({ state: "ready", machines: [{ name: "Windows one", selector: "opaque-one", state: "ready" }] }) }).mockResolvedValueOnce({ ok: false, json: async () => ({ password: "secret-error" }) });
 render(<SalesTrialRdp offeringId="offering" fetchImpl={fetchImpl} />);
 fireEvent.click(screen.getByRole("button", { name: "Check remote desktops" }));
 fireEvent.click(await screen.findByRole("button", { name: "Show credentials for Windows one" }));
 await screen.findByText(/Guest credentials are unavailable/);
 expect(document.body.innerHTML).not.toContain("secret-error");
 expect(screen.getByRole("link", { name: "Download RDP for Windows one" })).toBeTruthy();
});
