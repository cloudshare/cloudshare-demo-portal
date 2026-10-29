// @vitest-environment jsdom
import React from "react";
import { render, screen, fireEvent, cleanup, act } from "@testing-library/react";
import { beforeEach, afterEach, expect, it, vi } from "vitest";
import { SalesTrialRdp } from "./sales-trial-rdp";
beforeEach(() => {
 Object.defineProperty(HTMLDialogElement.prototype, "showModal", { configurable: true, value: vi.fn(function (this: HTMLDialogElement) { this.setAttribute("open", ""); this.querySelector<HTMLButtonElement>("button")?.focus(); }) });
 Object.defineProperty(HTMLDialogElement.prototype, "close", { configurable: true, value: vi.fn(function (this: HTMLDialogElement) { this.removeAttribute("open"); }) });
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); });
function openDialog() { if (!screen.queryByRole("dialog")) fireEvent.click(screen.getByRole("button", { name: "Remote desktops" })); }

it("checks available desktops on explicit action and uses native attachment links", async () => {
 const fetchImpl = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ state: "ready", machines: [{ name: "Windows one", selector: "opaque-one", state: "ready" }, { name: "Windows two", selector: "opaque-two", state: "preparing" }, { name: "Unavailable desktop", selector: "opaque-three", state: "unavailable", message: "Public remote access is not configured" }] }) });
 render(<SalesTrialRdp offeringId="offering" fetchImpl={fetchImpl} />);
 expect(fetchImpl).not.toHaveBeenCalled();
 openDialog();
 fireEvent.click(screen.getByRole("button", { name: "Check remote desktops" }));
 const link = await screen.findByRole("link", { name: "Download RDP for Windows one" });
 expect(link.getAttribute("href")).toBe("/api/sales-trial/offerings/offering/rdp/opaque-one");
 expect(link.hasAttribute("download")).toBe(true);
 expect(screen.getByText("Windows two")).toBeTruthy();
 expect(screen.getByText("Preparing")).toBeTruthy();
 expect(screen.getByText("Public remote access is not configured")).toBeTruthy();
 expect(screen.queryByRole("button", { name: "Show credentials for Unavailable desktop" })).toBeNull();
 expect(screen.queryByRole("link", { name: "Download RDP for Unavailable desktop" })).toBeNull();
 expect(screen.queryByRole("button", { name: "Show credentials for Windows two" })).toBeNull();
 expect(screen.queryByRole("link", { name: "Download RDP for Windows two" })).toBeNull();
 expect(fetchImpl).toHaveBeenCalledTimes(1);
});
it("reports an unavailable response without rendering a raw provider error", async () => {
 const fetchImpl = vi.fn().mockResolvedValue({ ok: false, json: async () => ({ password: "never-render" }) });
 render(<SalesTrialRdp offeringId="offering" fetchImpl={fetchImpl} />);
 openDialog();
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
 openDialog();
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
 openDialog();
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
 openDialog();
 fireEvent.click(screen.getByRole("button", { name: "Check remote desktops" }));
 fireEvent.click(await screen.findByRole("button", { name: "Show credentials for Windows one" }));
 await screen.findByText(/Guest credentials are unavailable/);
 expect(document.body.innerHTML).not.toContain("secret-error");
 expect(screen.queryByRole("group", { name: "Guest credentials for Windows one" })).toBeNull();
 expect(screen.queryByRole("button", { name: "Dismiss credentials" })).toBeNull();
 expect(screen.getByRole("button", { name: "Show credentials for Windows one" })).toBeTruthy();
 expect(screen.getByRole("link", { name: "Download RDP for Windows one" })).toBeTruthy();
});

it.each(["preparing", "failure"])("keeps %s discovery retryable until ready", async state => {
 const fetchImpl = vi.fn().mockResolvedValueOnce({ ok: state !== "failure", json: async () => ({ state, message: "Still preparing" }) }).mockResolvedValueOnce({ ok: true, json: async () => ({ state: "ready", machines: [{ name: "Desktop", selector: "opaque", state: "ready" }] }) });
 render(<SalesTrialRdp offeringId="offering" fetchImpl={fetchImpl} />);
 openDialog();
 fireEvent.click(screen.getByRole("button", { name: "Check remote desktops" }));
 await screen.findByText(state === "failure" ? /Remote desktop is unavailable/ : "Still preparing");
 expect((screen.getByRole("button", { name: "Check remote desktops" }) as HTMLButtonElement).disabled).toBe(false);
 openDialog();
 fireEvent.click(screen.getByRole("button", { name: "Check remote desktops" }));
 await screen.findByRole("link", { name: "Download RDP for Desktop" });
 expect((screen.getByRole("button", { name: "Check remote desktops" }) as HTMLButtonElement).disabled).toBe(true);
 expect(fetchImpl).toHaveBeenCalledTimes(2);
});
it("closing details discards credentials and pending responses while retaining the nonsecret ready listing", async () => {
 let resolve: (value: unknown) => void = () => undefined;
 const pending = new Promise(done => { resolve = done; });
 const fetchImpl = vi.fn().mockResolvedValueOnce({ ok: true, json: async () => ({ state: "ready", machines: [{ name: "Desktop", selector: "opaque", state: "ready" }] }) }).mockResolvedValueOnce({ ok: true, json: async () => ({ username: "guest-user", password: "guest-secret" }) }).mockReturnValueOnce(pending);
 const view = render(<SalesTrialRdp offeringId="offering" active fetchImpl={fetchImpl} />);
 openDialog();
 fireEvent.click(screen.getByRole("button", { name: "Check remote desktops" }));
 fireEvent.click(await screen.findByRole("button", { name: "Show credentials for Desktop" }));
 await screen.findByLabelText("Guest password");
 view.rerender(<SalesTrialRdp offeringId="offering" active={false} fetchImpl={fetchImpl} />);
 expect(document.body.innerHTML).not.toMatch(/guest-user|guest-secret/);
 view.rerender(<SalesTrialRdp offeringId="offering" active fetchImpl={fetchImpl} />);
 openDialog();
 expect(screen.queryByLabelText("Guest password")).toBeNull();
 expect((screen.getByRole("button", { name: "Check remote desktops" }) as HTMLButtonElement).disabled).toBe(true);
 expect(fetchImpl).toHaveBeenCalledTimes(2);
 fireEvent.click(screen.getByRole("button", { name: "Show credentials for Desktop" }));
 view.rerender(<SalesTrialRdp offeringId="offering" active={false} fetchImpl={fetchImpl} />);
 view.rerender(<SalesTrialRdp offeringId="offering" active fetchImpl={fetchImpl} />);
 openDialog();
 await act(async () => { resolve({ ok: true, json: async () => ({ username: "late-user", password: "late-secret" }) }); });
 expect(screen.queryByLabelText("Guest password")).toBeNull();
 expect(document.body.innerHTML).not.toMatch(/late-user|late-secret/);
 expect(fetchImpl).toHaveBeenCalledTimes(3);
});

it("opens a Trial-named modal without fetching and closes by Escape with focus returned", async () => {
 const fetchImpl = vi.fn();
 render(<SalesTrialRdp offeringId="offering" title="Helios trial" fetchImpl={fetchImpl} />);
 const trigger = screen.getByRole("button", { name: "Remote desktops" });
 trigger.focus(); fireEvent.click(trigger);
 const dialog = screen.getByRole("dialog", { name: "Remote desktops - Helios trial" });
 expect(HTMLDialogElement.prototype.showModal).toHaveBeenCalledTimes(1);
 expect(fetchImpl).not.toHaveBeenCalled();
 expect(document.activeElement).toBe(screen.getByRole("button", { name: "Close remote desktops" }));
 fireEvent(dialog, new Event("cancel", { bubbles: false, cancelable: true }));
 await act(async () => {});
 expect(screen.queryByRole("dialog")).toBeNull();
 expect(document.activeElement).toBe(trigger);
 expect(fetchImpl).not.toHaveBeenCalled();
});

it("closing the dialog discards pending credentials and reopens the ready list without discovery", async () => {
 let resolve: (value: unknown) => void = () => undefined;
 const fetchImpl = vi.fn().mockResolvedValueOnce({ ok: true, json: async () => ({ state: "ready", machines: [{ name: "Desktop", selector: "opaque", state: "ready" }] }) }).mockReturnValueOnce(new Promise(done => { resolve = done; }));
 render(<SalesTrialRdp offeringId="offering" fetchImpl={fetchImpl} />);
 openDialog(); fireEvent.click(screen.getByRole("button", { name: "Check remote desktops" }));
 fireEvent.click(await screen.findByRole("button", { name: "Show credentials for Desktop" }));
 fireEvent.click(screen.getByRole("button", { name: "Close remote desktops" }));
 await act(async () => { resolve({ ok: true, json: async () => ({ username: "late-user", password: "late-secret" }) }); });
 openDialog();
 expect(screen.queryByLabelText("Guest password")).toBeNull();
 expect(document.body.innerHTML).not.toMatch(/late-user|late-secret/);
 expect((screen.getByRole("button", { name: "Check remote desktops" }) as HTMLButtonElement).disabled).toBe(true);
 expect(fetchImpl).toHaveBeenCalledTimes(2);
});
