import { eligibleDjName } from "@workspace/lore-attribution";
import { sanitizeScheduleName } from "./schedule-name-sanitizer.js";

export interface StructuredShow {
  showName: string;
  dayOfWeek: string;
  startTime: string;
  endTime: string;
  djName: string | null;
}

const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;
const DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

function decodeHtml(value: string): string {
  return value
    .replace(/<[^>]+>/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&#0*39;|&apos;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&nbsp;|&#160;/g, " ")
    .replace(/&#(\d+);/g, (_, n: string) => String.fromCodePoint(Number(n)))
    .replace(/\s+/g, " ")
    .trim();
}

function clock24(time: string, meridiem?: string): string | null {
  const match = time.trim().match(/^(\d{1,2}):(\d{2})$/);
  if (!match) return null;
  let hour = Number(match[1]);
  const minute = Number(match[2]);
  if (minute > 59 || hour > 23) return null;
  if (meridiem) {
    if (hour < 1 || hour > 12) return null;
    const pm = meridiem.toLowerCase() === "pm";
    hour = hour % 12 + (pm ? 12 : 0);
  }
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

function minutesFromClock(time: string): number {
  return Number(time.slice(0, 2)) * 60 + Number(time.slice(3, 5));
}

function parseTimeRange(value: string): { start: string; end: string } | null {
  const match = value.match(
    /(\d{1,2})(?::(\d{2}))?\s*(am|pm)?\s*(?:[-–—]|to)\s*(\d{1,2})(?::(\d{2}))?\s*(am|pm)?/i,
  );
  if (!match) return null;
  const startMeridiem = match[3] || match[6];
  const endMeridiem = match[6] || match[3];
  const start = clock24(`${match[1]}:${match[2] ?? "00"}`, startMeridiem);
  const end = clock24(`${match[4]}:${match[5] ?? "00"}`, endMeridiem);
  return start && end ? { start, end } : null;
}

function makeShow(
  showNameRaw: string,
  day: string,
  startTime: string,
  endTime: string,
  djRaw = "",
): StructuredShow | null {
  const showName = sanitizeScheduleName(decodeHtml(showNameRaw));
  if (!showName || !DAYS.includes(day as (typeof DAYS)[number]) || !startTime || !endTime) return null;
  return {
    showName,
    dayOfWeek: day,
    startTime,
    endTime,
    djName: eligibleDjName(decodeHtml(djRaw), { showTitle: showName }) ?? null,
  };
}

/** WordPress advertises the exact REST representation of the current page. */
export function wordpressPageApiUrl(pageUrl: string, html: string): string | null {
  const links = html.matchAll(/<link\b[^>]*>/gi);
  for (const match of links) {
    const tag = match[0];
    if (!/type=["']application\/json["']/i.test(tag)) continue;
    const href = tag.match(/\bhref=["']([^"']+)["']/i)?.[1];
    if (!href) continue;
    try {
      const decoded = href.replace(/&#0*38;/g, "&").replace(/&amp;/g, "&");
      const url = new URL(decoded, pageUrl);
      if (url.origin === new URL(pageUrl).origin && /\/wp-json\/wp\/v2\/pages\/\d+\/?$/.test(url.pathname)) {
        return url.toString();
      }
    } catch {
      // Ignore malformed advertised links.
    }
  }
  return null;
}

export function wordpressRenderedContent(raw: string): string | null {
  try {
    const parsed = JSON.parse(raw) as { content?: { rendered?: unknown } };
    return typeof parsed.content?.rendered === "string" ? parsed.content.rendered : null;
  } catch {
    return null;
  }
}

/**
 * Parse ordinary weekly schedule tables. The first column is a time range and
 * remaining columns correspond to day headers. This covers WordPress core
 * tables without coupling the adapter to a station or theme.
 */
export function parseWeeklyScheduleTable(html: string): StructuredShow[] | null {
  const table = [...html.matchAll(/<table\b[^>]*>([\s\S]*?)<\/table>/gi)].find((m) =>
    DAY_NAMES.filter((day) => new RegExp(`\\b${day}\\b`, "i").test(decodeHtml(m[1]!))).length >= 3,
  );
  if (!table) return null;
  const rows = [...table[1]!.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)].map((row) =>
    [...row[1]!.matchAll(/<t[hd]\b[^>]*>([\s\S]*?)<\/t[hd]>/gi)].map((cell) => cell[1]!),
  );
  const header = rows.find((cells) => DAY_NAMES.filter((day) => cells.some((c) => new RegExp(`\\b${day}\\b`, "i").test(decodeHtml(c)))).length >= 3);
  if (!header) return null;
  const dayColumns = header.map((cell) => {
    const text = decodeHtml(cell).toLowerCase();
    const index = DAY_NAMES.findIndex((day) => text.includes(day.toLowerCase()));
    return index >= 0 ? DAYS[index]! : null;
  });
  const shows: StructuredShow[] = [];
  for (const cells of rows) {
    if (cells === header || cells.length < 2) continue;
    const range = parseTimeRange(decodeHtml(cells[0]!));
    if (!range) continue;
    for (let i = 1; i < cells.length && i < dayColumns.length; i++) {
      const day = dayColumns[i];
      const cell = cells[i]!;
      if (!day) continue;
      const anchors = [...cell.matchAll(/<a\b[^>]*>([\s\S]*?)<\/a>/gi)];
      const name = anchors[0]?.[1] ?? cell;
      const text = decodeHtml(name);
      if (!text || /^(off air|automation|no programming|—|-)$/i.test(text)) continue;
      const host = cell.match(/(?:with|host(?:ed)? by)\s+([^<|]+)/i)?.[1] ?? "";
      const show = makeShow(name, day, range.start, range.end, host);
      if (show) shows.push(show);
    }
  }
  return shows.length ? shows : null;
}

/** Parse the common QantumThemes recurring-show cards used by radio WordPress sites. */
export function parseQantumSchedule(html: string): StructuredShow[] | null {
  const cards = [...html.matchAll(/<div\b[^>]*class=["'][^"']*qt-part-(?:archive-item\s+)?qt-part-show-schedule-day(?:part|-item)[^"']*["'][^>]*>([\s\S]*?)(?=<div\b[^>]*class=["'][^"']*qt-part-(?:archive-item\s+)?qt-part-show-schedule-day(?:part|-item)|<\/section>|$)/gi)];
  const shows: StructuredShow[] = [];
  for (let i = 0; i < cards.length; i++) {
    const card = cards[i]![1]!;
    const dayName = card.match(/class=["'][^"']*qt-day[^"']*["'][^>]*>([^<]+)/i)?.[1]?.trim();
    const dayIndex = DAY_NAMES.findIndex((day) => day.toLowerCase() === dayName?.toLowerCase());
    const time = card.match(/class=["'][^"']*qt-time[^"']*["'][^>]*>([^<]+)<[\s\S]*?class=["'][^"']*qt-am[^"']*["'][^>]*>(am|pm)/i);
    const title = card.match(/<a\b[^>]*class=["'][^"']*\bqt-t\b[^"']*["'][^>]*>([\s\S]*?)<\/a>/i);
    if (dayIndex < 0 || !time || !title) continue;
    const start = clock24(time[1]!, time[2]!);
    if (!start) continue;
    const nextCard = cards[i + 1]?.[1] ?? "";
    const nextDay = nextCard.match(/class=["'][^"']*qt-day[^"']*["'][^>]*>([^<]+)/i)?.[1]?.trim();
    const nextTime = nextCard.match(/class=["'][^"']*qt-time[^"']*["'][^>]*>([^<]+)<[\s\S]*?class=["'][^"']*qt-am[^"']*["'][^>]*>(am|pm)/i);
    const end = nextDay?.toLowerCase() === dayName?.toLowerCase() && nextTime
      ? clock24(nextTime[1]!, nextTime[2]!)
      : "00:00";
    const host = card.match(/(?:with|host(?:ed)? by)\s+([^<]+)/i)?.[1] ?? "";
    const show = end ? makeShow(title[1]!, DAYS[dayIndex]!, start, end, host) : null;
    if (show) shows.push(show);
  }
  return shows.length ? shows : null;
}

export function parseJsonLdEvents(html: string): StructuredShow[] | null {
  const shows: StructuredShow[] = [];
  for (const script of html.matchAll(/<script\b[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
    let value: unknown;
    try { value = JSON.parse(script[1]!.trim()); } catch { continue; }
    const visit = (node: unknown) => {
      if (Array.isArray(node)) return node.forEach(visit);
      if (!node || typeof node !== "object") return;
      const item = node as Record<string, unknown>;
      if (Array.isArray(item["@graph"])) item["@graph"].forEach(visit);
      const types = Array.isArray(item["@type"]) ? item["@type"] : [item["@type"]];
      if (!types.includes("Event") || typeof item.name !== "string" || typeof item.startDate !== "string" || typeof item.endDate !== "string") return;
      const start = item.startDate.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/);
      const end = item.endDate.match(/T(\d{2}):(\d{2})/);
      if (!start || !end) return;
      const date = new Date(Date.UTC(Number(start[1]), Number(start[2]) - 1, Number(start[3])));
      const show = makeShow(item.name, DAYS[date.getUTCDay()]!, `${start[4]}:${start[5]}`, `${end[1]}:${end[2]}`);
      if (show) shows.push(show);
    };
    visit(value);
  }
  return shows.length ? shows : null;
}

export function googleCalendarIcsUrl(pageUrl: string, html: string): string | null {
  const match = html.match(/<(?:iframe|a)\b[^>]*(?:src|href)=["']([^"']*(?:calendar\.google\.com|calendar\.googleusercontent\.com)[^"']*)["']/i);
  if (!match) return null;
  try {
    const embedded = new URL(match[1]!.replace(/&amp;/g, "&"), pageUrl);
    if (
      embedded.protocol !== "https:" ||
      !["calendar.google.com", "calendar.googleusercontent.com"].includes(embedded.hostname)
    ) return null;
    const calendarId = embedded.searchParams.get("src");
    if (!calendarId) return embedded.pathname.endsWith(".ics") ? embedded.toString() : null;
    return `https://calendar.google.com/calendar/ical/${encodeURIComponent(calendarId)}/public/basic.ics`;
  } catch {
    return null;
  }
}

export interface CadenceScheduleSource {
  endpointUrl: string;
  receiptUrl: string;
  channelId: string;
}

/** NPR/public-radio Brightspot sites embed the shared Cadence schedule CMS. */
export function cadenceScheduleSource(pageUrl: string, html: string): CadenceScheduleSource | null {
  const match = html.match(/<iframe\b[^>]*src=["']([^"']*cadence\.nprstations\.org\/widgets\/iframe\/weekly[^"']*)["']/i);
  if (!match) return null;
  try {
    const widget = new URL(match[1]!.replace(/&amp;/g, "&"), pageUrl);
    if (widget.protocol !== "https:" || widget.hostname !== "cadence.nprstations.org") return null;
    const channelId = widget.searchParams.get("channelId");
    if (!channelId || !/^[0-9a-f-]{36}$/i.test(channelId)) return null;
    return {
      endpointUrl: "https://cadence.nprstations.org/api/cadence/widget/",
      receiptUrl: widget.toString(),
      channelId,
    };
  } catch {
    return null;
  }
}

export function parseCadenceSchedule(raw: string): StructuredShow[] | null {
  let value: unknown;
  try { value = JSON.parse(raw); } catch { return null; }
  const episodes = (value as { episodes?: unknown })?.episodes;
  if (!Array.isArray(episodes)) return null;
  const shows: StructuredShow[] = [];
  for (const row of episodes) {
    const episode = (row as { episode?: Record<string, unknown> })?.episode;
    const start = (episode?.start as { local?: unknown } | undefined)?.local;
    const end = (episode?.end as { local?: unknown } | undefined)?.local;
    if (typeof episode?.programName !== "string" || typeof start !== "string" || typeof end !== "string") return null;
    const startMatch = start.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/);
    const endMatch = end.match(/T(\d{2}):(\d{2})/);
    if (!startMatch || !endMatch) return null;
    const date = new Date(Date.UTC(Number(startMatch[1]), Number(startMatch[2]) - 1, Number(startMatch[3])));
    const show = makeShow(
      episode.programName,
      DAYS[date.getUTCDay()]!,
      `${startMatch[4]}:${startMatch[5]}`,
      `${endMatch[1]}:${endMatch[2]}`,
    );
    if (show) shows.push(show);
  }
  return shows;
}

/**
 * CKCU's guide is a 15-minute physical-row table. Program cells span the
 * physical rows they occupy, while a day class identifies the weekly column.
 * A shared day/start represents alternating programming, not a choice for us
 * to make, so every ambiguous slot is omitted from the recurring grid.
 */
export function parseCkcuGuide(html: string): StructuredShow[] | null {
  const table = [...html.matchAll(/<table\b[^>]*>([\s\S]*?)<\/table>/gi)].find((match) =>
    /\bid\s*=\s*(?:["']guidetable["']|guidetable)(?:\s|>)/i.test(match[0]),
  );
  if (!table) return null;
  const dayByClass: Record<string, string> = {
    sun: "Sun", mon: "Mon", tue: "Tue", wed: "Wed", thu: "Thu", fri: "Fri", sat: "Sat",
  };
  const candidates: StructuredShow[] = [];
  let currentMinutes: number | null = null;
  for (const row of table[1]!.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)) {
    const cells = [...row[1]!.matchAll(/<td\b([^>]*)>([\s\S]*?)<\/td>/gi)].map((cell) => ({
      attributes: cell[1]!,
      body: cell[2]!,
    }));
    const timeCell = cells.find((cell) => /\btml\b/i.test(cell.attributes));
    if (timeCell) {
      const time = clock24(decodeHtml(timeCell.body));
      const rowspan = timeCell.attributes.match(/\browspan=["']?(\d+)["']?/i)?.[1];
      if (!time || !rowspan || !Number.isInteger(Number(rowspan)) || Number(rowspan) < 1) {
        currentMinutes = null;
        continue;
      }
      currentMinutes = minutesFromClock(time);
    } else if (currentMinutes !== null) {
      currentMinutes = (currentMinutes + 15) % (24 * 60);
    }
    if (currentMinutes === null) continue;
    for (const cell of cells) {
      const className = cell.attributes.match(/\bclass=["']([^"']+)["']/i)?.[1] ?? "";
      const dayClass = Object.keys(dayByClass).find((day) => new RegExp(`\\b${day}\\b`, "i").test(className));
      if (!dayClass) continue;
      const rowspan = cell.attributes.match(/\browspan=["']?(\d+)["']?/i)?.[1] ?? "1";
      const physicalRows = Number(rowspan);
      const anchor = cell.body.match(/<a\b[^>]*>([\s\S]*?)<\/a>/i)?.[1];
      if (
        !anchor ||
        !Number.isInteger(physicalRows) ||
        physicalRows < 1 ||
        physicalRows > 96
      ) continue;
      const startTime = `${String(Math.floor(currentMinutes / 60)).padStart(2, "0")}:${String(currentMinutes % 60).padStart(2, "0")}`;
      const endMinutes = (currentMinutes + physicalRows * 15) % (24 * 60);
      const endTime = `${String(Math.floor(endMinutes / 60)).padStart(2, "0")}:${String(endMinutes % 60).padStart(2, "0")}`;
      if (startTime === endTime) continue;
      const show = makeShow(anchor, dayByClass[dayClass]!, startTime, endTime);
      if (show && show.showName.length <= 200) candidates.push(show);
    }
  }
  const ambiguous = new Set<string>();
  const namesBySlot = new Map<string, Set<string>>();
  for (const show of candidates) {
    const key = `${show.dayOfWeek}|${show.startTime}`;
    const names = namesBySlot.get(key) ?? new Set<string>();
    names.add(show.showName.toLowerCase());
    namesBySlot.set(key, names);
    if (names.size > 1) ambiguous.add(key);
  }
  const seen = new Set<string>();
  const exactSlotFiltered = candidates.filter((show) => {
    const slot = `${show.dayOfWeek}|${show.startTime}`;
    const key = `${slot}|${show.showName.toLowerCase()}`;
    if (ambiguous.has(slot) || seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  // CKCU also represents alternating programs with staggered starts, so they
  // can overlap without sharing an exact slot key. Remove every participant
  // in such a conflict rather than letting array order choose a winner.
  const weekDays = new Map(
    ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((day, index) => [day, index]),
  );
  const intervals = exactSlotFiltered.map((show) => {
    const start = minutesFromClock(show.startTime);
    const end = minutesFromClock(show.endTime);
    const duration = (end - start + 24 * 60) % (24 * 60);
    return {
      start: weekDays.get(show.dayOfWeek)! * 24 * 60 + start,
      endOffset: duration,
    };
  });
  const overlapping = new Set<number>();
  const weekMinutes = 7 * 24 * 60;
  for (let left = 0; left < intervals.length; left++) {
    const a = intervals[left]!;
    for (let right = left + 1; right < intervals.length; right++) {
      const b = intervals[right]!;
      for (const shift of [-weekMinutes, 0, weekMinutes]) {
        const bStart = b.start + shift;
        if (a.start < bStart + b.endOffset && bStart < a.start + a.endOffset) {
          overlapping.add(left);
          overlapping.add(right);
          break;
        }
      }
    }
  }
  return exactSlotFiltered.filter((_, index) => !overlapping.has(index)).slice(0, 168);
}

export function parseCalendarIcs(raw: string): StructuredShow[] | null {
  const unfolded = raw.replace(/\r?\n[ \t]/g, "");
  const shows: StructuredShow[] = [];
  for (const block of unfolded.matchAll(/BEGIN:VEVENT\r?\n([\s\S]*?)END:VEVENT/g)) {
    const body = block[1]!;
    const summary = body.match(/^SUMMARY(?:;[^:]*)?:(.+)$/m)?.[1];
    const start = body.match(/^DTSTART(?:;[^:]*)?:(\d{8})T(\d{2})(\d{2})/m);
    const end = body.match(/^DTEND(?:;[^:]*)?:(\d{8})T(\d{2})(\d{2})/m);
    if (!summary || !start || !end) continue;
    const date = new Date(Date.UTC(Number(start[1]!.slice(0, 4)), Number(start[1]!.slice(4, 6)) - 1, Number(start[1]!.slice(6, 8))));
    const show = makeShow(summary.replace(/\\([,;\\])/g, "$1"), DAYS[date.getUTCDay()]!, `${start[2]}:${start[3]}`, `${end[2]}:${end[3]}`);
    if (show) shows.push(show);
  }
  return shows.length ? shows : null;
}

export function parseStructuredScheduleHtml(html: string): StructuredShow[] | null {
  return parseJsonLdEvents(html) ?? parseWeeklyScheduleTable(html) ?? parseQantumSchedule(html);
}