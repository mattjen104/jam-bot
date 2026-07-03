/**
 * Symmetric encryption for OAuth tokens stored in service_connections.
 *
 * Algorithm: AES-256-GCM (authenticated encryption — prevents both
 * tampering and leakage).
 *
 * Wire format (all hex, colon-delimited):
 *   <iv_hex>:<authTag_hex>:<ciphertext_hex>
 *
 * Key source: LORE_TOKEN_KEY env var (32 random bytes, hex-encoded → 64
 * hex chars).  In development, if the var is absent, a deterministic
 * all-zeros key is used with a warning so the server doesn't crash; in
 * production you MUST set the var.
 *
 * Rotation: bumping the key invalidates all stored tokens.  Users will
 * need to re-connect.  Keep the old key around during a rotation window
 * and implement try-old-key fallback before removing it.
 */

import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";

const ALGO = "aes-256-gcm";
const KEY_BYTES = 32;
const IV_BYTES = 12;
const TAG_BYTES = 16;

let _key: Buffer | null = null;

function getKey(): Buffer {
  if (_key) return _key;

  const raw = process.env["LORE_TOKEN_KEY"];
  if (!raw) {
    console.warn(
      "[token-crypto] LORE_TOKEN_KEY is not set — using insecure fallback key. " +
        "Set this env var before deploying.",
    );
    _key = Buffer.alloc(KEY_BYTES, 0);
    return _key;
  }

  const keyBuf = Buffer.from(raw, "hex");
  if (keyBuf.length !== KEY_BYTES) {
    throw new Error(
      `LORE_TOKEN_KEY must be a 64-hex-char (32-byte) string; got ${raw.length} chars`,
    );
  }
  _key = keyBuf;
  return _key;
}

/**
 * Encrypt a plaintext string.
 * Returns `<iv_hex>:<authTag_hex>:<ciphertext_hex>`.
 */
export function encryptToken(plaintext: string): string {
  const key = getKey();
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGO, key, iv);
  const enc = Buffer.concat([
    cipher.update(plaintext, "utf8"),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();
  return `${iv.toString("hex")}:${tag.toString("hex")}:${enc.toString("hex")}`;
}

/**
 * Decrypt a ciphertext produced by `encryptToken`.
 * Throws on tampered ciphertext or wrong key.
 */
export function decryptToken(ciphertext: string): string {
  const key = getKey();
  const parts = ciphertext.split(":");
  if (parts.length !== 3) {
    throw new Error("decryptToken: malformed ciphertext (expected iv:tag:enc)");
  }
  const [ivHex, tagHex, encHex] = parts as [string, string, string];
  const iv = Buffer.from(ivHex, "hex");
  const tag = Buffer.from(tagHex, "hex");
  const enc = Buffer.from(encHex, "hex");

  if (iv.length !== IV_BYTES || tag.length !== TAG_BYTES) {
    throw new Error("decryptToken: malformed iv or auth tag length");
  }

  const decipher = createDecipheriv(ALGO, key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(enc), decipher.final()]).toString(
    "utf8",
  );
}

/**
 * Returns true when the string looks like an encrypted token (iv:tag:enc
 * hex triple).  Used to detect legacy plaintext tokens during migration.
 */
export function isEncryptedToken(value: string): boolean {
  const parts = value.split(":");
  if (parts.length !== 3) return false;
  return parts.every((p) => /^[0-9a-f]+$/i.test(p));
}

// Prevent key from leaking if someone accidentally logs the module.
export default { encryptToken, decryptToken, isEncryptedToken };

// Self-check: ensure timingSafeEqual is available (Node ≥ 6.6)
void timingSafeEqual;
