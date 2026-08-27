export interface FirstPlayDate {
  releaseDate: string | null;
  releaseYear: number | null;
}

export function releaseDateLabel(item: FirstPlayDate): string {
  if (item.releaseDate) {
    const match = /^(\d{4})(?:-(\d{2})(?:-(\d{2}))?)?$/.exec(item.releaseDate);
    if (match) {
      const [, year, month, day] = match;
      const monthName = month
        ? new Date(Date.UTC(2000, Number(month) - 1, 1)).toLocaleString("en-US", {
            month: "short",
            timeZone: "UTC",
          })
        : null;
      if (monthName && day) return `${Number(day)} ${monthName} ${year}`;
      if (monthName) return `${monthName} ${year}`;
      return year;
    }
  }
  return item.releaseYear != null ? String(item.releaseYear) : "Date unknown";
}