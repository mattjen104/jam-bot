/**
 * ShowsFeedLane — the Dial's Shows lens feed.
 *
 * Renders upcoming concerts for the listener's taste artists (Bandsintown),
 * soonest-first, through the same row anatomy as the live and press feeds:
 * primary sentence leads at full weight (`fdrow__t1`), the ticket/event link
 * is the byline (`fdrow__t3`). Dotted links navigate out.
 *
 * City prompt:
 *   First time the lens opens, an inline prompt asks for the listener's city
 *   (free-text, stored in localStorage via dialLensState). The city is editable
 *   from the same spot. No geolocation, no accounts.
 *
 * Bandsintown attribution:
 *   "Powered by Bandsintown" is shown whenever event rows are visible, per
 *   Bandsintown API terms.
 *
 * Honest empty states (all settled-gated by the caller's flags):
 *   - No taste → nudge (caller renders via Zone1Placeholder)
 *   - Still computing → "Looking up shows…"
 *   - Settled, no events → "No shows on the horizon for your artists"
 */

import { useState, useRef, useEffect } from "react";
import { type ShowsEvent } from "../../lib/meHooks";
import { showsSentence } from "../dialViewHelpers";

export interface ShowsFeedLaneProps {
  events: ShowsEvent[];
  /** True while the server reports computing (background fetches in flight). */
  isLoading: boolean;
  /** False when the listener has no taste sources — caller shows nudge. */
  hasTaste: boolean;
  /** Listener's saved city for proximity sorting (null = not set). */
  city: string | null;
  /** Persist the city the listener enters. */
  onSetCity: (city: string | null) => void;
  /** Navigate to the artist tab/page — same affordance as other crossing rows. */
  onArtistClick: (artistName: string) => void;
}

/** Rows shown per scroll step (matches the live feed's initial page size). */
const SHOWS_PAGE = 12;

export function ShowsFeedLane({
  events,
  isLoading,
  hasTaste,
  city,
  onSetCity,
  onArtistClick,
}: ShowsFeedLaneProps) {
  const [visible, setVisible] = useState(SHOWS_PAGE);
  const sentinelRef = useRef<HTMLDivElement | null>(null);
  const hasObserver = typeof IntersectionObserver !== "undefined";
  const shown = hasObserver ? events.slice(0, visible) : events;
  const exhaustedLocal = visible >= events.length;

  // Infinite scroll via IntersectionObserver sentinel
  useEffect(() => {
    if (!hasObserver) return;
    const el = sentinelRef.current;
    if (!el) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (!entries.some((e) => e.isIntersecting)) return;
        setVisible((v) => v + SHOWS_PAGE);
      },
      { rootMargin: "200px" },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [hasObserver, exhaustedLocal]);

  // ── Empty / degraded states — settled-gated by the caller's flags ──────
  if (!hasTaste) return null; // caller renders the taste nudge

  if (isLoading && events.length === 0) {
    return (
      <div className="z1-placeholder z1-placeholder--computing">
        <div className="z1-placeholder__body">
          <p className="z1-placeholder__pitch">
            Looking up shows for your artists…
          </p>
        </div>
      </div>
    );
  }

  if (events.length === 0) {
    return (
      <>
        <ShowsCityPrompt city={city} onSetCity={onSetCity} />
        <div className="z1-placeholder z1-placeholder--no-cross z1-placeholder--compact">
          <div className="z1-placeholder__body">
            <p className="z1-placeholder__pitch">
              No upcoming shows on the horizon for your artists.
              {city ? ` We checked globally and near ${city}.` : " Check back as tour dates are announced."}
            </p>
          </div>
        </div>
      </>
    );
  }

  // With a city set, split into a "near you" band then "elsewhere" (same band
  // pattern as the live feed). With no city, one flat soonest-first list.
  const nearShown = city ? shown.filter((e) => e.nearCity) : [];
  const restShown = city ? shown.filter((e) => !e.nearCity) : shown;

  return (
    <div id="shows-feed-rows">
      <ShowsCityPrompt city={city} onSetCity={onSetCity} />
      {nearShown.length > 0 && (
        <div className="dial-feed-band" data-feed-band="near-city" aria-label={`Near ${city}`}>
          <span className="dial-feed-band__label">Near you</span>
        </div>
      )}
      {nearShown.map((e) => <ShowsRow key={e.id} event={e} onArtistClick={onArtistClick} />)}
      {nearShown.length > 0 && restShown.length > 0 && (
        <div className="dial-feed-band" data-feed-band="elsewhere" aria-label="Elsewhere">
          <span className="dial-feed-band__label">Elsewhere</span>
        </div>
      )}
      {restShown.map((e) => <ShowsRow key={e.id} event={e} onArtistClick={onArtistClick} />)}
      {!exhaustedLocal && (
        <div ref={sentinelRef} className="dial-feed-sentinel" aria-hidden="true" />
      )}
      <BandsintownAttribution />
    </div>
  );
}

// ---------------------------------------------------------------------------
// City prompt — inline, editable, locally persisted
// ---------------------------------------------------------------------------

function ShowsCityPrompt({
  city,
  onSetCity,
}: {
  city: string | null;
  onSetCity: (city: string | null) => void;
}) {
  const [editing, setEditing] = useState(!city); // auto-open when no city set
  const [draft, setDraft] = useState(city ?? "");
  const inputRef = useRef<HTMLInputElement | null>(null);

  // Focus input when editing opens
  useEffect(() => {
    if (editing && inputRef.current) {
      inputRef.current.focus();
    }
  }, [editing]);

  const commit = () => {
    const trimmed = draft.trim();
    onSetCity(trimmed || null);
    setEditing(false);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") { commit(); }
    if (e.key === "Escape") { setDraft(city ?? ""); setEditing(false); }
  };

  if (!editing && city) {
    return (
      <div className="shows-city-prompt shows-city-prompt--set">
        <span className="shows-city-prompt__label">
          Near <b>{city}</b>
        </span>
        <button
          type="button"
          className="shows-city-prompt__edit"
          onClick={() => { setDraft(city); setEditing(true); }}
          aria-label="Change city"
        >
          change
        </button>
      </div>
    );
  }

  return (
    <div className="shows-city-prompt" role="group" aria-label="Your city for show proximity">
      <label className="shows-city-prompt__label" htmlFor="shows-city-input">
        {city ? "Change city:" : "Shows near you — enter your city:"}
      </label>
      <span className="shows-city-prompt__field">
        <input
          id="shows-city-input"
          ref={inputRef}
          type="text"
          className="shows-city-prompt__input"
          placeholder="e.g. Portland, OR"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={handleKeyDown}
          maxLength={100}
          aria-label="Your city"
        />
        <button
          type="button"
          className="shows-city-prompt__save"
          onClick={commit}
          aria-label="Save city"
        >
          Save
        </button>
        {city && (
          <button
            type="button"
            className="shows-city-prompt__cancel"
            onClick={() => { setDraft(city); setEditing(false); }}
            aria-label="Cancel"
          >
            Cancel
          </button>
        )}
        {city && (
          <button
            type="button"
            className="shows-city-prompt__clear"
            onClick={() => { setDraft(""); onSetCity(null); setEditing(false); }}
            aria-label="Clear city"
          >
            Clear
          </button>
        )}
      </span>
      <span className="shows-city-prompt__hint">
        Stored locally on this device — no account needed.
      </span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Single shows row
// ---------------------------------------------------------------------------

function ShowsRow({
  event,
  onArtistClick,
}: {
  event: ShowsEvent;
  onArtistClick: (artistName: string) => void;
}) {
  const now = new Date();
  const result = showsSentence(
    {
      artistName: event.artistName,
      eventDate: event.eventDate,
      venueName: event.venueName,
      venueCity: event.venueCity,
      venueRegion: event.venueRegion,
      ticketUrl: event.ticketUrl,
    },
    now,
  );
  if (!result) return null;

  const { node, dateLabel } = result;

  return (
    <div
      className={`fdrow fdrow--z1 fdrow--shows${event.nearCity ? " fdrow--near-city" : ""}`}
      data-event-date={event.eventDate}
    >
      <div className="fdrow__c">
        {/* Tier 1: the Shows sentence — artist leads, venue+date is the body */}
        <div className="fdrow__t1 w3">
          <button
            type="button"
            className="fdrow__artist-link"
            onClick={() => onArtistClick(event.artistName)}
            aria-label={`Open ${event.artistName}`}
          >
            {node}
          </button>
        </div>
        {/* Tier 3: ticket/event link — dotted = navigates */}
        <div className="fdrow__t3">
          {event.ticketUrl ? (
            <a
              href={event.ticketUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="fdrow__source-link"
              onClick={(e) => e.stopPropagation()}
            >
              {dateLabel} · {event.venueCity}{event.venueRegion ? `, ${event.venueRegion}` : ""} ↗
            </a>
          ) : (
            <span>
              {dateLabel} · {event.venueCity}{event.venueRegion ? `, ${event.venueRegion}` : ""}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Bandsintown attribution (required by API terms)
// ---------------------------------------------------------------------------

function BandsintownAttribution() {
  return (
    <div className="shows-attribution" aria-label="Data attribution">
      <span className="shows-attribution__text">Powered by Bandsintown</span>
    </div>
  );
}
