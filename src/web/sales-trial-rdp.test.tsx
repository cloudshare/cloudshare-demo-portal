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

const ready = { ok: true, json: async () => ({ state: "ready", machines: [{ name: "Desktop A", selector: "a", state: "ready" }, { name: "Desktop B", selector: "b", state: "ready" }, { name: "Unavailable", selector: "c", state: "unavailable", message: "Public remote access is not configured" }] }) };
const guest = { ok: true, json: async () => ({ username: "guest-user", password: "guest-secret" }) };
async function select(name = "Desktop A") { fireEvent.click(await screen.findByRole("button", { name: `Select desktop ${name}` })); }
async function retrieve(name = "Desktop A") { await select(name); fireEvent.click(screen.getByRole("button", { name: `Show credentials for ${name}` })); }

it("first open discovers metadata only and cached reopening preserves native Escape focus behavior", async () => {
 const fetchImpl = vi.fn().mockResolvedValue(ready);
 render(<SalesTrialRdp offeringId="offering" title="Helios trial" fetchImpl={fetchImpl} />);
 expect(fetchImpl).not.toHaveBeenCalled();
 const trigger = screen.getByRole("button", { name: "Remote desktops" });
 trigger.focus(); openDialog();
 expect(fetchImpl).toHaveBeenCalledWith("/api/sales-trial/offerings/offering/rdp", { cache: "no-store" });
 const dialog = screen.getByRole("dialog", { name: "Remote desktops - Helios trial" });
 expect(document.activeElement).toBe(screen.getByRole("button", { name: "Close remote desktops" }));
 await select();
 expect(screen.getByRole("link", { name: "Download RDP for Desktop A" }).getAttribute("href")).toBe("/api/sales-trial/offerings/offering/rdp/a");
 expect(screen.getByText("Public remote access is not configured")).toBeTruthy();
 expect(screen.queryByRole("button", { name: "Select desktop Unavailable" })).toBeNull();
 expect(screen.queryByLabelText("Guest password")).toBeNull();
 expect(screen.queryByRole("button", { name: "Retry desktops" })).toBeNull();
 fireEvent(dialog, new Event("cancel", { cancelable: true }));
 await act(async () => {});
 expect(document.activeElement).toBe(trigger);
 openDialog();
 expect(screen.queryByRole("link", { name: "Download RDP for Desktop A" })).toBeNull();
 expect(fetchImpl).toHaveBeenCalledTimes(1);
});
it.each(["preparing", "failure"])("%s metadata requires explicit Retry, never automatic reopen retry", async state => {
 const fetchImpl = vi.fn().mockResolvedValueOnce({ ok: state !== "failure", json: async () => ({ state, message: "Preparing" }) }).mockResolvedValueOnce(ready);
 render(<SalesTrialRdp offeringId="offering" fetchImpl={fetchImpl} />);
 openDialog();
 await screen.findByRole("button", { name: "Retry desktops" });
 fireEvent.click(screen.getByRole("button", { name: "Close remote desktops" })); openDialog();
 expect(fetchImpl).toHaveBeenCalledTimes(1);
 fireEvent.click(screen.getByRole("button", { name: "Retry desktops" }));
 await select();
 expect(fetchImpl).toHaveBeenCalledTimes(2);
 expect(screen.queryByRole("button", { name: "Retry desktops" })).toBeNull();
});
it("does not repeat an in-flight metadata request on reopen", async () => {
 let resolve: (value: unknown) => void = () => undefined;
 const fetchImpl = vi.fn().mockReturnValue(new Promise(done => { resolve = done; }));
 render(<SalesTrialRdp offeringId="offering" fetchImpl={fetchImpl} />);
 openDialog(); fireEvent.click(screen.getByRole("button", { name: "Close remote desktops" })); openDialog();
 expect(fetchImpl).toHaveBeenCalledTimes(1);
 await act(async () => { resolve(ready); });
 await select();
});
it("keeps one selected credential panel, masks values, copies explicitly and discards on Hide or VM change", async () => {
 const copy = vi.fn().mockResolvedValue(undefined);
 Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText: copy } });
 const fetchImpl = vi.fn().mockResolvedValueOnce(ready).mockResolvedValue(guest);
 render(<SalesTrialRdp offeringId="offering" fetchImpl={fetchImpl} />);
 openDialog(); await retrieve();
 expect((await screen.findByLabelText("Guest username")).getAttribute("type")).toBe("password");
 expect(screen.getByLabelText("Guest password").getAttribute("type")).toBe("password");
 fireEvent.click(screen.getByRole("button", { name: "Copy password" }));
 expect(copy).toHaveBeenCalledWith("guest-secret");
 fireEvent.click(screen.getByRole("button", { name: "Show password" }));
 expect(screen.getByLabelText("Guest password").getAttribute("type")).toBe("text");
 fireEvent.click(screen.getByRole("button", { name: "Hide password" }));
 expect(screen.queryByLabelText("Guest password")).toBeNull();
 await retrieve(); await screen.findByLabelText("Guest password");
 await select("Desktop B");
 expect(screen.queryByLabelText("Guest password")).toBeNull();
 expect(screen.queryByRole("button", { name: "Show credentials for Desktop A" })).toBeNull();
 expect(fetchImpl).toHaveBeenCalledTimes(3);
 await select();
 expect(screen.queryByLabelText("Guest password")).toBeNull();
 expect(fetchImpl).toHaveBeenCalledTimes(3);
});
it.each(["dialog", "details", "selection", "pagehide", "unmount", "dismiss"])("invalidates a pending credential response on %s", async closure => {
 let resolve: (value: unknown) => void = () => undefined;
 const fetchImpl = vi.fn().mockResolvedValueOnce(ready).mockReturnValueOnce(new Promise(done => { resolve = done; }));
 const view = render(<SalesTrialRdp offeringId="offering" fetchImpl={fetchImpl} />);
 openDialog(); await retrieve();
 if (closure === "dialog") fireEvent.click(screen.getByRole("button", { name: "Close remote desktops" }));
 if (closure === "details") view.rerender(<SalesTrialRdp offeringId="offering" active={false} fetchImpl={fetchImpl} />);
 if (closure === "selection") await select("Desktop B");
 if (closure === "pagehide") act(() => window.dispatchEvent(new Event("pagehide")));
 if (closure === "unmount") view.unmount();
 if (closure === "dismiss") fireEvent.click(screen.getByRole("button", { name: "Dismiss credentials" }));
 await act(async () => { resolve(guest); });
 if (closure === "details") view.rerender(<SalesTrialRdp offeringId="offering" active fetchImpl={fetchImpl} />);
 if (closure === "details" || closure === "dialog") openDialog();
 expect(screen.queryByLabelText("Guest password")).toBeNull();
 expect(document.body.innerHTML).not.toMatch(/guest-user|guest-secret/);
 expect(fetchImpl).toHaveBeenCalledTimes(2);
});
it("keeps credential errors compact and retryable without disabling file download", async () => {
 const fetchImpl = vi.fn().mockResolvedValueOnce(ready).mockResolvedValueOnce({ ok: false, json: async () => ({ password: "secret-error" }) }).mockResolvedValueOnce(guest);
 render(<SalesTrialRdp offeringId="offering" fetchImpl={fetchImpl} />);
 openDialog(); await retrieve();
 await screen.findByText(/Guest credentials are unavailable/);
 expect(document.body.innerHTML).not.toContain("secret-error");
 expect(screen.queryByRole("group", { name: "Guest credentials for Desktop A" })).toBeNull();
 expect(screen.queryByRole("button", { name: "Dismiss credentials" })).toBeNull();
 expect(screen.getByRole("link", { name: "Download RDP for Desktop A" })).toBeTruthy();
 await retrieve(); await screen.findByLabelText("Guest password");
 expect(fetchImpl).toHaveBeenCalledTimes(3);
});
