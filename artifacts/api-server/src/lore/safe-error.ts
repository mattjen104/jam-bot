/**
 * Convert an arbitrary failure into operationally useful text without retaining
 * common credential-bearing query parameters or config-style key/value pairs.
 */
export function safeFailureMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message
    // Error URLs are operationally useful without query values. Redacting all
    // values avoids relying on an inevitably incomplete provider key denylist.
    .replace(
      /([?&][^=&#\s]{1,64}=)[^&#\s]*/g,
      "$1[REDACTED]",
    )
    .replace(
      /\b(authorization\s*:\s*)[^\r\n]*/gi,
      "$1[REDACTED]",
    )
    .replace(
      /\b((?:access[-_]?token|refresh[-_]?token|api[-_]?key|x-api-key|token|secret|client[-_]?secret|password|passwd|session(?:id)?)\s*[:=]\s*)[^\s,;}]+/gi,
      "$1[REDACTED]",
    )
    .replace(/\b((?:set-cookie|cookie)\s*:\s*)[^\r\n]*/gi, "$1[REDACTED]")
    .replace(/(https?:\/\/)[^/@\s]+:[^/@\s]+@/gi, "$1[REDACTED]@")
    .replace(/\b(?:Bearer|Basic)\s+[A-Za-z0-9._~+/-]+=*/gi, (match) =>
      `${match.slice(0, match.indexOf(" "))} [REDACTED]`,
    )
    .replace(/\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g, "[REDACTED]");
}