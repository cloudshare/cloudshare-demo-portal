/** @vitest-environment jsdom */
import { afterEach, describe, expect, it, vi } from "vitest";
import { startPortalSessionWatchdog } from "./session-expiry";

describe("portal session watchdog browser events", () => {
  afterEach(() => vi.restoreAllMocks());

  it("revalidates from the real document visibility event and expires once", async () => {
    const fetchImpl = vi.fn().mockResolvedValue({ status: 401 });
    const onExpired = vi.fn();
    vi.spyOn(document, "visibilityState", "get").mockReturnValue("visible");
    const watchdog = startPortalSessionWatchdog({
      fetchImpl,
      onExpired,
      setIntervalFn: vi.fn().mockReturnValue(1),
      clearIntervalFn: vi.fn(),
    });

    document.dispatchEvent(new Event("visibilitychange"));
    await vi.waitFor(() => expect(onExpired).toHaveBeenCalledTimes(1));

    document.dispatchEvent(new Event("visibilitychange"));
    await Promise.resolve();
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(onExpired).toHaveBeenCalledTimes(1);
    watchdog.stop();
  });
});
