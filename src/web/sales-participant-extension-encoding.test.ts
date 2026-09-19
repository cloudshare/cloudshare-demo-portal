import { readFileSync } from "node:fs";
import { expect, it } from "vitest";

it("keeps the Participant extension browser source valid UTF-8 for Next compilation", () => {
  const source = readFileSync(new URL("./sales-participant-extension.tsx", import.meta.url));
  expect(() => new TextDecoder("utf-8", { fatal: true }).decode(source)).not.toThrow();
});
