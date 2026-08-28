/** A compact, deterministic badge label for stations without trustworthy art. */
export function stationInitials(name: string): string {
  const words = name
    .replace(/\b(?:AM|FM)\b/gi, " ")
    .replace(/[^A-Za-z0-9]+/g, " ")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (words.length === 0) return "RAD";

  const callsign = words.find(
    (word) => /^[A-Z0-9]{2,5}$/.test(word) && /[A-Z]/.test(word),
  );
  if (callsign) return callsign.slice(0, 4);
  if (words.length === 1) return words[0]!.slice(0, 3).toUpperCase();
  return words
    .slice(0, 2)
    .map((word) => word[0])
    .join("")
    .toUpperCase();
}