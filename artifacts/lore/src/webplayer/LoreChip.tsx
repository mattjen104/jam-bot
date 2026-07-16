import { BookOpen } from "lucide-react";
import type { WpLoreCount } from "./hooks";

/**
 * Lore chip — compact "N · M lists" pill that opens the album lore panel.
 * Renders nothing when the recording has no lore yet (honest absence).
 */
export function LoreChip({
  count,
  onOpen,
}: {
  count: WpLoreCount | undefined;
  onOpen: () => void;
}) {
  if (!count || (count.artifactCount === 0 && count.listCount === 0)) return null;

  const parts: string[] = [];
  if (count.artifactCount > 0) parts.push(String(count.artifactCount));
  if (count.listCount > 0)
    parts.push(`${count.listCount} ${count.listCount === 1 ? "list" : "lists"}`);

  return (
    <button
      type="button"
      onClick={onOpen}
      className="wp-pill"
      style={{ display: "inline-flex", alignItems: "center", gap: 5 }}
      aria-label="Open album lore"
      data-testid="lore-chip"
    >
      <BookOpen size={13} aria-hidden="true" />
      {parts.join(" · ")}
    </button>
  );
}
