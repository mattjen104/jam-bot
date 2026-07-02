import { useEffect, useRef, useState } from "react";
import { Check, Share2 } from "lucide-react";

interface ShareButtonProps {
  /** Share path under /api/share, e.g. "songs/abc-123" or "stations/kexp". */
  sharePath: string;
  /** Testid suffix, e.g. "song" | "station" | "station-run" | "picker" | "picker-run". */
  kind: string;
}

/**
 * Copies a share link to the clipboard. The link points at the API's share
 * page (rich OG preview for unfurl bots), which instantly redirects human
 * visitors into the app.
 */
export function ShareButton({ sharePath, kind }: ShareButtonProps) {
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => () => clearTimeout(timer.current), []);

  const copy = async () => {
    const url = `${window.location.origin}/api/share/${sharePath}`;
    try {
      await navigator.clipboard.writeText(url);
    } catch {
      // Clipboard API can be unavailable (permissions, older browsers).
      window.prompt("Copy this share link:", url);
      return;
    }
    setCopied(true);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setCopied(false), 2000);
  };

  return (
    <button
      type="button"
      onClick={copy}
      data-testid={`share-${kind}`}
      title="Copy a share link — unfurls with a preview card wherever you paste it"
      className={
        copied
          ? "hover-elevate inline-flex items-center gap-1.5 rounded-full border border-primary-border bg-primary/15 px-3.5 py-1.5 font-mono text-[11px] uppercase tracking-wide text-primary"
          : "hover-elevate inline-flex items-center gap-1.5 rounded-full border border-border bg-card px-3.5 py-1.5 font-mono text-[11px] uppercase tracking-wide text-foreground"
      }
    >
      {copied ? (
        <Check className="h-3.5 w-3.5" />
      ) : (
        <Share2 className="h-3.5 w-3.5" />
      )}
      {copied ? "Copied" : "Share"}
    </button>
  );
}
