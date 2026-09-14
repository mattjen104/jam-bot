const RETURN_PARAM = "returnTo";
export const SCROLL_PARAM = "scroll";
const APP_PREFIX = "/lore";

function isSafeInternalPath(value: string): boolean {
  return value.startsWith("/") && !value.startsWith("//") && !value.includes("\\");
}

/** Strip the deployment prefix once; router links receive app-relative paths. */
export function normalizeAppRelativePath(value: string): string | null {
  if (!isSafeInternalPath(value)) return null;
  if (value === APP_PREFIX) return "/";
  if (value.startsWith(`${APP_PREFIX}/`)) return value.slice(APP_PREFIX.length);
  return value;
}

/** Preserve the complete Library URL (filters, layout and focus) in one value. */
export function appendReturnState(href: string, returnTo?: string | null): string {
  const normalized = returnTo ? normalizeAppRelativePath(returnTo) : null;
  if (!normalized) return href;
  const separator = href.includes("?") ? "&" : "?";
  return `${href}${separator}${RETURN_PARAM}=${encodeURIComponent(normalized)}`;
}

/** Add the current document position to a same-origin return destination. */
export function captureReturnState(returnTo: string, scrollY?: number): string {
  const normalized = normalizeAppRelativePath(returnTo);
  if (!normalized) return returnTo;
  const url = new URL(normalized, window.location.origin);
  const position = Math.max(0, scrollY ?? window.scrollY ?? 0);
  url.searchParams.set(SCROLL_PARAM, String(position));
  return normalizeAppRelativePath(`${url.pathname}${url.search}`) ?? "/";
}

export function readReturnState(search: string): string | null {
  const value = new URLSearchParams(search).get(RETURN_PARAM);
  return value ? normalizeAppRelativePath(value) : null;
}

export function stripReturnState(search: string): string {
  const params = new URLSearchParams(search);
  params.delete(RETURN_PARAM);
  const result = params.toString();
  return result ? `?${result}` : "";
}

export function readScrollState(search: string): number | null {
  const raw = new URLSearchParams(search).get(SCROLL_PARAM);
  if (raw == null || !/^(?:\d+|\d+\.\d+)$/.test(raw)) return null;
  const value = Number(raw);
  return Number.isFinite(value) && value >= 0 ? value : null;
}