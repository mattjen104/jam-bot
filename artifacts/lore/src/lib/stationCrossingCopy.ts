export function stationCrossingSentence(
  artistNames: readonly string[],
  crossingCount: number,
): string | null {
  const names = [...new Set(artistNames.map((name) => name.trim()).filter(Boolean))].slice(0, 3);
  if (names.length === 0) return null;

  const named = names.length === 1
    ? names[0]
    : names.length === 2
      ? `${names[0]} and ${names[1]}`
      : `${names[0]}, ${names[1]}, and ${names[2]}`;
  const remainder = Math.max(0, crossingCount - names.length);
  return `Played ${named}${remainder > 0 ? `, and ${remainder} more` : ""} from your library.`;
}