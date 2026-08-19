/**
 * StationAdminContextMenu — right-click "Remove from Lore…" for admin cleanup.
 *
 * Wraps a station row anywhere in the listener UI. When no admin token is
 * stored (localStorage "lore_admin_token"), it renders children unchanged so
 * right-click behaves exactly as before. With a token present, right-click
 * opens a small context menu whose single item permanently removes the
 * station via DELETE /api/admin/stations/:id/permanent.
 *
 * The confirm step fetches a removal preview (name, spin count, curated flag)
 * and uses window.confirm — matching the AdminRadioBrowser page's confirm
 * pattern. Curated seed stations get a stronger warning: they are hidden +
 * excluded from re-seeding rather than deleted.
 *
 * Deliberately provider-free (no react-query hooks): parent components pass
 * `onRemoved` to refetch their own station queries, keeping this component
 * safe in presentational trees like DialFeedLane.
 */
import { useState, type ReactNode } from "react";
import {
  ContextMenu,
  ContextMenuTrigger,
  ContextMenuContent,
  ContextMenuItem,
} from "../ui/context-menu";
import { useAdminToken } from "../../hooks/useAdminToken";

interface RemovalPreview {
  id: number;
  name: string;
  slug: string;
  source: string;
  curated: boolean;
  spinCount: number;
}

export interface StationAdminContextMenuProps {
  stationId: number;
  stationName: string;
  /** Called after a successful removal so the parent can refetch stations. */
  onRemoved?: (() => void) | undefined;
  children: ReactNode;
}

export function StationAdminContextMenu({
  stationId,
  stationName,
  onRemoved,
  children,
}: StationAdminContextMenuProps) {
  const { token } = useAdminToken();
  const [busy, setBusy] = useState(false);

  // No admin token → passthrough: native right-click behavior is untouched.
  if (!token) return <>{children}</>;

  const handleRemove = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const previewRes = await fetch(
        `/api/admin/stations/${stationId}/removal-preview`,
        { headers: { "x-admin-token": token } },
      );
      if (!previewRes.ok) {
        window.alert(
          `Could not load removal details for ${stationName} (${previewRes.status}).`,
        );
        return;
      }
      const preview = (await previewRes.json()) as RemovalPreview;

      const spinLine = `${preview.spinCount} logged spin${preview.spinCount === 1 ? "" : "s"} will be deleted with it.`;
      const message = preview.curated
        ? `"${preview.name}" is a seed-defined (curated) station.\n\nIt will be hidden, deactivated, and excluded from re-seeding so it never comes back — but its row and history are kept.\n\nRemove it from Lore?`
        : `Permanently remove "${preview.name}" from Lore?\n\n${spinLine}\nIt will never be re-discovered by the Radio Browser worker.\n\nThis cannot be undone from the UI.`;
      if (!window.confirm(message)) return;

      const res = await fetch(`/api/admin/stations/${stationId}/permanent`, {
        method: "DELETE",
        headers: { "x-admin-token": token },
      });
      if (!res.ok) {
        window.alert(`Removal failed (${res.status}).`);
        return;
      }
      onRemoved?.();
    } catch {
      window.alert(`Removal failed — network error.`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        {/* Radix needs a single DOM child to attach oncontextmenu to. */}
        <div style={{ display: "contents" }}>{children}</div>
      </ContextMenuTrigger>
      <ContextMenuContent>
        <ContextMenuItem
          disabled={busy}
          onSelect={() => {
            void handleRemove();
          }}
          data-testid={`station-remove-${stationId}`}
        >
          Remove from Lore…
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  );
}
