import { useEffect, useRef, useCallback } from "react";
import { proxyArtUrl } from "../lib/proxyArt";
import { X, ExternalLink } from "lucide-react";
import {
  useGetRecordingKnowledge,
  getGetRecordingKnowledgeQueryKey,
} from "@workspace/api-client-react";
import { buildLinerGroups } from "../lib/linerNotes";

type Section = "radio" | "selectors" | "library";

interface FooterAction {
  section: Section;
  label: string;
  artworkUrl: string | null;
  /** CSS color token for the section accent */
  accentVar: string;
  resumeLabel: string;
}

interface LinerNotesSheetProps {
  mbid: string;
  title: string;
  artist: string;
  artworkUrl: string | null;
  // Footer sleeve art
  radioArt: string | null;
  selectorArt: string | null;
  libraryArt: string | null;
  onResume: (section: Section) => void;
  onDismiss: () => void;
  busy: boolean;
}

export function LinerNotesSheet({
  mbid,
  title,
  artist,
  artworkUrl,
  radioArt,
  selectorArt,
  libraryArt,
  onResume,
  onDismiss,
  busy,
}: LinerNotesSheetProps) {
  const sheetRef = useRef<HTMLDivElement>(null);
  const swipeStartYRef = useRef<number | null>(null);
  const swipeDeltaRef = useRef<number>(0);

  const { data, isLoading } = useGetRecordingKnowledge(mbid, {
    query: {
      queryKey: getGetRecordingKnowledgeQueryKey(mbid),
      staleTime: 10 * 60_000,
      gcTime: 30 * 60_000,
    },
  });

  const knowledge = data?.knowledge ?? null;
  const claims = data?.claims ?? [];
  const groups = !isLoading ? buildLinerGroups(knowledge, claims) : null;

  // Dismiss on Escape
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onDismiss();
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [onDismiss]);

  // Swipe-down to dismiss — attached to the drag handle only, so the
  // scrollable body retains normal touch/pointer behaviour.
  const onHandlePointerDown = useCallback((e: React.PointerEvent) => {
    swipeStartYRef.current = e.clientY;
    swipeDeltaRef.current = 0;
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  }, []);

  const onHandlePointerMove = useCallback((e: React.PointerEvent) => {
    if (swipeStartYRef.current === null) return;
    const delta = e.clientY - swipeStartYRef.current;
    if (delta > 0) {
      swipeDeltaRef.current = delta;
      if (sheetRef.current) {
        sheetRef.current.style.transform = `translateY(${delta}px)`;
        sheetRef.current.style.transition = "none";
      }
    }
  }, []);

  const onHandlePointerUp = useCallback(() => {
    if (swipeStartYRef.current === null) return;
    swipeStartYRef.current = null;
    if (swipeDeltaRef.current > 80) {
      onDismiss();
    } else {
      // Snap back
      if (sheetRef.current) {
        sheetRef.current.style.transform = "";
        sheetRef.current.style.transition = "";
      }
    }
    swipeDeltaRef.current = 0;
  }, [onDismiss]);

  const footerActions: FooterAction[] = [
    { section: "radio", label: "Radio", artworkUrl: radioArt, accentVar: "--accent", resumeLabel: "Resume live" },
    { section: "selectors", label: "Selectors", artworkUrl: selectorArt, accentVar: "--picker", resumeLabel: "Resume Ghost Radio" },
    { section: "library", label: "Library", artworkUrl: libraryArt, accentVar: "--library", resumeLabel: "Open album" },
  ];

  return (
    <>
      {/* Backdrop */}
      <div
        className="liner-sheet__backdrop"
        aria-hidden="true"
        onClick={onDismiss}
      />

      {/* Sheet */}
      <div
        ref={sheetRef}
        className="liner-sheet"
        role="dialog"
        aria-modal="true"
        aria-label="Liner notes"
      >
        {/* Drag handle — swipe down here to dismiss */}
        <div
          className="liner-sheet__handle"
          aria-hidden="true"
          onPointerDown={onHandlePointerDown}
          onPointerMove={onHandlePointerMove}
          onPointerUp={onHandlePointerUp}
          onPointerCancel={onHandlePointerUp}
        />

        {/* Header */}
        <div className="liner-sheet__header">
          {artworkUrl ? (
            <img
              src={proxyArtUrl(artworkUrl)!}
              alt=""
              className="liner-sheet__header-art"
              draggable={false}
            />
          ) : (
            <div className="liner-sheet__header-art liner-sheet__header-art--empty" />
          )}
          <div className="liner-sheet__header-copy">
            <strong className="liner-sheet__header-title">{title}</strong>
            <span className="liner-sheet__header-artist">{artist}</span>
          </div>
          <button
            type="button"
            className="liner-sheet__close"
            onClick={onDismiss}
            aria-label="Close liner notes"
          >
            <X aria-hidden="true" />
          </button>
        </div>

        {/* Body */}
        <div className="liner-sheet__body">
          {isLoading ? (
            <div className="liner-sheet__skeleton-wrap">
              {[0, 1, 2].map((i) => (
                <div key={i} className="liner-sheet__skeleton-row" />
              ))}
            </div>
          ) : groups && groups.length > 0 ? (
            groups.map((group) => (
              <div key={group.label} className="liner-sheet__section">
                <p className="liner-sheet__section-label">{group.label}</p>
                <ul className="liner-sheet__row-list">
                  {group.rows.map((row) => (
                    <li key={row.id} className="liner-sheet__row">
                      {row.label && (
                        <span className="liner-sheet__row-label">{row.label}</span>
                      )}
                      <span className="liner-sheet__row-text">{row.text}</span>
                      <span className="liner-sheet__row-chips">
                        {row.sourceLabel && (
                          <span className="liner-sheet__source-chip">
                            {row.sourceLabel}
                          </span>
                        )}
                        {row.sourceUrl && (
                          <a
                            href={row.sourceUrl}
                            target="_blank"
                            rel="noreferrer"
                            className="liner-sheet__source-link"
                            onClick={(e) => e.stopPropagation()}
                            aria-label={`Open source for ${row.text.slice(0, 40)}`}
                          >
                            <ExternalLink aria-hidden="true" />
                          </a>
                        )}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            ))
          ) : (
            <p className="liner-sheet__empty">No liner notes available</p>
          )}
        </div>

        {/* Footer */}
        <div className="liner-sheet__footer">
          {footerActions.map(({ section, label, artworkUrl: art, accentVar, resumeLabel }) => (
            <button
              key={section}
              type="button"
              className="liner-sheet__footer-btn"
              style={{ "--section-accent": `hsl(var(${accentVar}))` } as React.CSSProperties}
              disabled={busy}
              onClick={() => {
                onDismiss();
                onResume(section);
              }}
              aria-label={`${resumeLabel} (${label})`}
            >
              <span className="liner-sheet__footer-art">
                {art ? (
                  <img src={proxyArtUrl(art)!} alt="" draggable={false} />
                ) : (
                  <span className="liner-sheet__footer-art--empty" />
                )}
              </span>
              <span className="liner-sheet__footer-label">{label}</span>
            </button>
          ))}
        </div>
      </div>
    </>
  );
}
