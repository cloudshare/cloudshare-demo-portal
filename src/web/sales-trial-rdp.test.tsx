// @vitest-environment jsdom
import React from "react";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
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
