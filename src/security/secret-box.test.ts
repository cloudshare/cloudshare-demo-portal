import { describe, expect, it } from "vitest";
import { createSecretBox, SecretBoxError } from "./secret-box";

const masterKey = Buffer.alloc(32, 7);

describe("createSecretBox", () => {
  it("round-trips CloudShare credentials without leaving plaintext in the ciphertext", () => {
    const box = createSecretBox(masterKey);

    const ciphertext = box.encrypt("cloudshare-api-key");

    expect(ciphertext).not.toContain("cloudshare-api-key");
    expect(box.decrypt(ciphertext)).toBe("cloudshare-api-key");
  });

  it("rejects a malformed master key length", () => {
    expect(() => createSecretBox(Buffer.alloc(16, 1))).toThrow(SecretBoxError);
  });

  it("fails closed when the ciphertext cannot be authenticated", () => {
    const box = createSecretBox(masterKey);
    const ciphertext = box.encrypt("cloudshare-api-key");
    const tampered = `${ciphertext.slice(0, -2)}aa`;

    expect(() => box.decrypt(tampered)).toThrow(SecretBoxError);
  });
});
