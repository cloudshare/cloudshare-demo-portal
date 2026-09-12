import { describe, expect, it } from "vitest";
import { reduceParticipantRowInteraction } from "./sales-participant-row-interaction";

describe("participant row interaction", () => {
  it("supports deterministic range selection", () => {
    const initial = { activeId: "a", selectedIds: new Set(["a"]), anchorId: "a", focus: "row" as const };
    const result = reduceParticipantRowInteraction(initial, { type: "select", id: "c", ids: ["a", "b", "c"], shift: true });
    expect([...result.selectedIds]).toEqual(["a", "b", "c"]);
  });
  it("keeps inspection and escape as explicit focus transitions", () => {
    const state = { activeId: "a", selectedIds: new Set(["a"]), anchorId: "a", focus: "row" as const };
    expect(reduceParticipantRowInteraction(state, { type: "inspect", id: "a" }).focus).toBe("inspector");
    expect(reduceParticipantRowInteraction({ ...state, focus: "inspector" }, { type: "escape" }).focus).toBe("row");
  });
});
