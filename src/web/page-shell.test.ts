import { describe, expect, it } from "vitest";
import { PAGE_SHELL_MAX_WIDTH, pageShellStyle } from "./page-shell";

describe("page shell", () => {
  it("defines a single shared max width for authenticated app pages", () => {
    expect(pageShellStyle.maxWidth).toBe(PAGE_SHELL_MAX_WIDTH);
    expect(pageShellStyle).toMatchObject({
      margin: "0 auto",
      width: "100%",
      boxSizing: "border-box",
    });
  });

  it("keeps side padding usable on narrow (mobile-width) viewports", () => {
    const [, sidePadding] = String(pageShellStyle.padding).split(" ");
    expect(sidePadding).toBe("1.25rem");
  });
});
