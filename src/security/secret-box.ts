import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

const ALGORITHM = "aes-256-gcm";

export class SecretBoxError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SecretBoxError";
  }
}

export interface SecretBox {
  encrypt(plaintext: string): string;
  decrypt(ciphertext: string): string;
}

export function createSecretBox(masterKey: Buffer): SecretBox {
  if (masterKey.byteLength !== 32) {
    throw new SecretBoxError("Portal master key must decode to exactly 32 bytes");
  }

  return {
    encrypt(plaintext: string): string {
      const iv = randomBytes(12);
      const cipher = createCipheriv(ALGORITHM, masterKey, iv);
      const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
      const tag = cipher.getAuthTag();
      return [
        iv.toString("base64url"),
        tag.toString("base64url"),
        encrypted.toString("base64url"),
      ].join(".");
    },

    decrypt(ciphertext: string): string {
      const [ivEncoded, tagEncoded, payloadEncoded] = ciphertext.split(".");
      if (!ivEncoded || !tagEncoded || !payloadEncoded) {
        throw new SecretBoxError("Encrypted secret had an invalid format");
      }

      try {
        const iv = Buffer.from(ivEncoded, "base64url");
        const tag = Buffer.from(tagEncoded, "base64url");
        const payload = Buffer.from(payloadEncoded, "base64url");
        const decipher = createDecipheriv(ALGORITHM, masterKey, iv);
        decipher.setAuthTag(tag);
        const decrypted = Buffer.concat([decipher.update(payload), decipher.final()]);
        return decrypted.toString("utf8");
      } catch {
        throw new SecretBoxError("Encrypted secret could not be decrypted with the portal master key");
      }
    },
  };
}
