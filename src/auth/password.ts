import { randomBytes, scrypt as scryptCallback, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";

const scrypt = promisify(scryptCallback);

const PASSWORD_SCHEME = "scrypt";
const KEY_LENGTH = 64;

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16).toString("base64url");
  const derived = (await scrypt(password, salt, KEY_LENGTH)) as Buffer;
  return `${PASSWORD_SCHEME}$${salt}$${derived.toString("base64url")}`;
}

export async function verifyPassword(
  password: string,
  storedHash: string,
): Promise<boolean> {
  const [scheme, salt, expected] = storedHash.split("$");
  if (scheme !== PASSWORD_SCHEME || !salt || !expected) {
    return false;
  }

  const derived = (await scrypt(password, salt, KEY_LENGTH)) as Buffer;
  const expectedBuffer = Buffer.from(expected, "base64url");
  if (derived.length !== expectedBuffer.length) {
    return false;
  }

  return timingSafeEqual(derived, expectedBuffer);
}
