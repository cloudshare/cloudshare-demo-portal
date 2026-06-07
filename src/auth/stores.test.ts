import { describe, it, expect } from "vitest";
import {
  createInMemoryConsumedTokenStore,
  createInMemoryCandidateSessionStore,
} from "./stores";

describe("InMemoryConsumedTokenStore", () => {
  it("consumes a jti once and rejects the second attempt", async () => {
    const store = createInMemoryConsumedTokenStore();
    expect(await store.consume("jti-1")).toBe(true);
    expect(await store.consume("jti-1")).toBe(false);
  });

  it("tracks distinct jtis independently", async () => {
    const store = createInMemoryConsumedTokenStore();
    expect(await store.consume("jti-a")).toBe(true);
    expect(await store.consume("jti-b")).toBe(true);
  });
});

describe("InMemoryCandidateSessionStore", () => {
  it("saves a session and finds it again by id (survives lookup)", async () => {
    const store = createInMemoryCandidateSessionStore();
    const session = {
      sessionId: "s-1",
      examAttemptId: "ea-1",
      candidateId: "c-1",
      issuedAtMs: 1000,
    };
    await store.save(session);
    expect(await store.findById("s-1")).toEqual(session);
  });

  it("returns null for an unknown session id", async () => {
    const store = createInMemoryCandidateSessionStore();
    expect(await store.findById("missing")).toBeNull();
  });
});
