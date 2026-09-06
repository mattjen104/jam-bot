/**
 * Convert an arbitrary failure into operationally useful text without retaining
 * common credential-bearing query parameters or config-style key/value pairs.
 */
export function safeFailureMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message
    .replace(
      /([?&](?:access-token|access_token|apiKey|api_key|token)=)[^&#\s]*/gi,
      "$1[REDACTED]",
    )
    .replace(
      /\b((?:access-token|access_token|apiKey|api_key|token)\s*[:=]\s*)[^\s,;}]+/gi,
      "$1[REDACTED]",
    );
}