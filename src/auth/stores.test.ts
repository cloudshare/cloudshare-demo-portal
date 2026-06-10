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

  it("reset() clears all sessions so previously saved sessions are not found after reset", async () => {
    const store = createInMemoryCandidateSessionStore();
    await store.save({ sessionId: "s-1", examAttemptId: "ea-1", candidateId: "c-1", issuedAtMs: 1000 });
    store.reset();
    expect(await store.findById("s-1")).toBeNull();
  });
});

describe("InMemoryConsumedTokenStore reset", () => {
  it("reset() clears consumed jtis so tokens can be re-consumed after reset", async () => {
    const store = createInMemoryConsumedTokenStore();
    expect(await store.consume("jti-1")).toBe(true);
    expect(await store.consume("jti-1")).toBe(false);
    store.reset();
    expect(await store.consume("jti-1")).toBe(true);
  });
});
