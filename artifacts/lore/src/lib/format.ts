export function timeAgo(iso: string): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "";
  const secs = Math.max(0, Math.floor((Date.now() - then) / 1000));
  if (secs < 45) return "just now";
  const mins = Math.floor(secs / 60);
  if (mins < 1) return "just now";
  if (mins === 1) return "1 min ago";
  if (mins < 60) return `${mins} min ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs === 1) return "1 hr ago";
  return `${hrs} hrs ago`;
}

export function clockTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

/** Human date for an archived run ("Jun 2, 2024"). Accepts "YYYY-MM-DD" (a
 * UTC broadcast day) or a full ISO timestamp — both render in UTC so the
 * label always matches the documented air date. */
export function runDate(isoOrDay: string): string {
  const d = new Date(
    /^\d{4}-\d{2}-\d{2}$/.test(isoOrDay) ? `${isoOrDay}T00:00:00Z` : isoOrDay,
  );
  if (Number.isNaN(d.getTime())) return isoOrDay;
  return d.toLocaleDateString([], {
    year: "numeric",
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
}
