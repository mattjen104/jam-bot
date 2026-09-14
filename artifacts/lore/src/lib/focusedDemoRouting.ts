export function focusedDemoRedirectPath(location: string): string | null {
  const path = location.split("?")[0] || "/";
  const isPath = (prefix: string) => path === prefix || path.startsWith(`${prefix}/`);
  const supported =
    isPath("/library") ||
    path.startsWith("/song/") ||
    path.startsWith("/artist/") ||
    path.startsWith("/album/") ||
    path.startsWith("/credits/") ||
    path.startsWith("/credit/") ||
    path.startsWith("/labels/") ||
    path.startsWith("/label/") ||
    path.startsWith("/replay/") ||
    isPath("/admin");
  return supported ? null : "/library";
}

export function shouldRenderStandalonePlayer(
  location: string,
  demoSurface: boolean,
): boolean {
  const path = location.split("?")[0] || "/";
  const isPlayer = path === "/player" || path.startsWith("/player/");
  return isPlayer && !demoSurface;
}