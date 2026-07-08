import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  clearLabWindows,
  closeLabWindow,
  getLabWindow,
  isLabWindowOpen,
  openLabWindow,
} from "./lab-window";

function fakeWindow() {
  return { closed: false, close: vi.fn(), focus: vi.fn() };
}

beforeEach(() => {
  clearLabWindows();
});

describe("clearLabWindows", () => {
  it("removes all retained handles so tests start from a clean slate", () => {
    openLabWindow("ea-clear-1", "https://classic/login", () => fakeWindow());

    clearLabWindows();

    expect(getLabWindow("ea-clear-1")).toBeUndefined();
    expect(isLabWindowOpen("ea-clear-1")).toBe(false);
  });
});

describe("openLabWindow", () => {
  it("opens the requested URL and retains the handle for later liveness checks", () => {
    const handle = fakeWindow();
    const opener = vi.fn(() => handle);

    const returned = openLabWindow("ea-open-1", "https://classic/login", opener);

    expect(opener).toHaveBeenCalledWith("https://classic/login", "lab_ea-open-1");
    expect(returned).toBe(handle);
    expect(getLabWindow("ea-open-1")).toBe(handle);
  });

  it("reports liveness from the retained handle's closed flag", () => {
    const handle = fakeWindow();
    openLabWindow("ea-live-1", "https://classic/login", () => handle);

    expect(isLabWindowOpen("ea-live-1")).toBe(true);
    handle.closed = true;
    expect(isLabWindowOpen("ea-live-1")).toBe(false);
  });

  it("reports not-open for an attempt that was never launched", () => {
    expect(isLabWindowOpen("never-launched")).toBe(false);
    expect(getLabWindow("never-launched")).toBeUndefined();
  });

  it("throws when the popup is blocked (opener returns null)", () => {
    expect(() => openLabWindow("ea-blocked-1", "https://classic/login", () => null)).toThrow(
      /blocked/i,
    );
  });

  it("closes and forgets a retained child window", () => {
    const handle = fakeWindow();
    openLabWindow("ea-close-1", "/enter?examAttemptId=ea-close-1", () => handle);

    closeLabWindow("ea-close-1");

    expect(handle.close).toHaveBeenCalledTimes(1);
    expect(getLabWindow("ea-close-1")).toBeUndefined();
    expect(isLabWindowOpen("ea-close-1")).toBe(false);
  });
});
