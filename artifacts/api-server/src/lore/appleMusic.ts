import { createSign } from "node:crypto";

const APPLE_MUSIC_API_BASE = "https://api.music.apple.com";
const TOKEN_TTL_SECONDS = 60 * 60;

/**
 * How many seconds before expiry the server proactively mints a fresh token.
 * Must be at least as long as the client's stale time (5 minutes) plus a
 * safety buffer so that any token the client caches will still be valid when
 * MusicKit JS uses it, even if the client holds onto it for the full stale
 * window before trying to play.
 *
 *   client staleTime = 5 min → REFRESH_MARGIN_SECONDS = 6 min gives a
 *   one-minute buffer beyond the client's max hold time.
 */
const REFRESH_MARGIN_SECONDS = 6 * 60;

let cachedToken: { token: string; expiresAt: number } | null = null;

function configuredValues(): {
  teamId: string;
  keyId: string;
  privateKey: string;
  appName: string;
} | null {
  const teamId = process.env.APPLE_MUSIC_TEAM_ID?.trim();
  const keyId = process.env.APPLE_MUSIC_KEY_ID?.trim();
  const privateKey = process.env.APPLE_MUSIC_PRIVATE_KEY?.trim();
  if (!teamId || !keyId || !privateKey) return null;
  return {
    teamId,
    keyId,
    privateKey: privateKey.replace(/\\n/g, "\n"),
    appName: process.env.APPLE_MUSIC_APP_NAME?.trim() || "Lore",
  };
}

/** True when the server can mint a MusicKit developer token. */
export function isAppleMusicConfigured(): boolean {
  return configuredValues() !== null;
}

/**
 * Convert OpenSSL's DER encoded ECDSA signature into the raw R || S form
 * required by JWT's ES256 algorithm. The private key never leaves the server.
 */
function derSignatureToJose(signature: Buffer): Buffer {
  let offset = 0;
  if (signature[offset++] !== 0x30) throw new Error("Invalid ES256 signature");
  const sequenceLength = signature[offset++];
  if (sequenceLength === undefined) throw new Error("Invalid ES256 signature");
  if (sequenceLength & 0x80) offset += sequenceLength & 0x7f;

  const readInteger = (): Buffer => {
    if (signature[offset++] !== 0x02) throw new Error("Invalid ES256 signature");
    const length = signature[offset++];
    if (length === undefined) throw new Error("Invalid ES256 signature");
    const value = signature.subarray(offset, offset + length);
    offset += length;
    const padded = Buffer.alloc(32);
    value.copy(padded, Math.max(0, 32 - value.length), Math.max(0, value.length - 32));
    return padded;
  };

  return Buffer.concat([readInteger(), readInteger()]);
}

function base64Url(value: string | Buffer): string {
  return Buffer.from(value)
    .toString("base64")
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/g, "");
}

/** Mint a short-lived Apple Music developer token on demand. */
export function getAppleMusicDeveloperToken(): string | null {
  const config = configuredValues();
  if (!config) return null;
  const now = Math.floor(Date.now() / 1000);
  if (cachedToken && cachedToken.expiresAt > now + REFRESH_MARGIN_SECONDS) return cachedToken.token;

  const header = base64Url(JSON.stringify({ alg: "ES256", kid: config.keyId, typ: "JWT" }));
  const payload = base64Url(JSON.stringify({
    iss: config.teamId,
    iat: now,
    exp: now + TOKEN_TTL_SECONDS,
  }));
  const signingInput = `${header}.${payload}`;
  const signer = createSign("SHA256");
  signer.update(signingInput);
  signer.end();
  const derSignature = signer.sign({
    key: config.privateKey,
    dsaEncoding: "der",
  });
  const token = `${signingInput}.${base64Url(derSignatureToJose(derSignature))}`;
  cachedToken = { token, expiresAt: now + TOKEN_TTL_SECONDS };
  return token;
}

/** Reset the in-process token cache. Test-only — never call in production. */
export function _resetTokenCacheForTesting(): void {
  cachedToken = null;
}

export function getAppleMusicClientConfig(): {
  configured: boolean;
  developerToken: string | null;
  appName: string;
  apiBase: string;
  storefront: string;
} {
  const config = configuredValues();
  return {
    configured: config !== null,
    developerToken: getAppleMusicDeveloperToken(),
    appName: config?.appName ?? "Lore",
    apiBase: APPLE_MUSIC_API_BASE,
    // Storefront is public configuration. Keep it separate from the signing
    // credentials so MusicKit can use the same storefront the server uses for
    // its materialization receipt.
    storefront: process.env.APPLE_MUSIC_STOREFRONT?.trim() || "us",
  };
}
