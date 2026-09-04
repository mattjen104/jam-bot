import { useId, useState } from "react";
import {
  getSuggestArchiveArtistsQueryKey,
  useSuggestArchiveArtists,
} from "@workspace/api-client-react";
import { useDebouncedValue } from "../hooks/useDebouncedValue";
import { MAX_TASTE_SEEDS } from "../lib/tasteSeeds";

// ---------------------------------------------------------------------------
// SeedInput — single-line artist-name input with an Add button.
// Used by DialView's onboarding placeholder and the Library empty state.
// ---------------------------------------------------------------------------
export function SeedInput({
  seeds,
  onAdd,
  placeholder = "e.g. Radiohead",
  inputId,
}: {
  seeds: string[];
  onAdd: (artist: string) => void;
  placeholder?: string;
  inputId?: string;
}) {
  const [value, setValue] = useState("");
  const [activeIndex, setActiveIndex] = useState(-1);
  const [focused, setFocused] = useState(false);
  const generatedId = useId();
  const listboxId = `${inputId ?? generatedId}-suggestions`;
  const debouncedQuery = useDebouncedValue(value.trim(), 300);
  const suggestionsEnabled = focused && debouncedQuery.length >= 2;
  const { data, isFetching } = useSuggestArchiveArtists(
    { q: debouncedQuery },
    {
      query: {
        queryKey: getSuggestArchiveArtistsQueryKey({ q: debouncedQuery }),
        enabled: suggestionsEnabled,
        staleTime: 5 * 60_000,
      },
    },
  );
  const suggestions = suggestionsEnabled
    ? (data?.suggestions ?? []).filter(
        (suggestion) => !seeds.some(
          (seed) => seed.trim().toLocaleLowerCase() === suggestion.name.toLocaleLowerCase(),
        ),
      )
    : [];
  const listboxOpen = focused && (isFetching || suggestions.length > 0);

  const submit = (artist = value) => {
    const trimmed = artist.trim();
    if (!trimmed) return;
    onAdd(trimmed);
    setValue("");
    setActiveIndex(-1);
  };

  return (
    <div className="seed-input-row">
      <div className="seed-input-combobox">
        <input
          id={inputId}
          className="seed-input"
          type="text"
          role="combobox"
          placeholder={placeholder}
          value={value}
          onFocus={() => setFocused(true)}
          onBlur={() => {
            setFocused(false);
            setActiveIndex(-1);
          }}
          onChange={(event) => {
            setValue(event.target.value);
            setActiveIndex(-1);
          }}
          onKeyDown={(event) => {
            if (event.key === "ArrowDown" && suggestions.length > 0) {
              event.preventDefault();
              setActiveIndex((index) => (index + 1) % suggestions.length);
            } else if (event.key === "ArrowUp" && suggestions.length > 0) {
              event.preventDefault();
              setActiveIndex((index) => index <= 0 ? suggestions.length - 1 : index - 1);
            } else if (event.key === "Enter") {
              event.preventDefault();
              submit(activeIndex >= 0 ? suggestions[activeIndex]?.name : value);
            } else if (event.key === "Escape") {
              setFocused(false);
              setActiveIndex(-1);
            }
          }}
          maxLength={100}
          autoComplete="off"
          autoCorrect="off"
          spellCheck={false}
          aria-label="Artist name"
          aria-autocomplete="list"
          aria-controls={listboxId}
          aria-expanded={listboxOpen}
          aria-activedescendant={
            activeIndex >= 0 ? `${listboxId}-option-${activeIndex}` : undefined
          }
          data-testid="input-artist-seed"
        />
        {listboxOpen && (
          <div
            id={listboxId}
            className="seed-input-suggestions"
            role="listbox"
            aria-label="Artist suggestions"
            data-testid="list-artist-suggestions"
          >
            {isFetching && suggestions.length === 0 ? (
              <div className="seed-input-suggestions__status" role="status">
                Finding artists…
              </div>
            ) : suggestions.map((suggestion, index) => (
              <button
                id={`${listboxId}-option-${index}`}
                key={suggestion.name.toLocaleLowerCase()}
                type="button"
                role="option"
                aria-selected={index === activeIndex}
                className="seed-input-suggestion"
                onMouseDown={(event) => event.preventDefault()}
                onMouseEnter={() => setActiveIndex(index)}
                onClick={() => submit(suggestion.name)}
                data-testid={`option-artist-${index}`}
              >
                {suggestion.name}
              </button>
            ))}
          </div>
        )}
      </div>
      <button
        type="button"
        className="seed-add-btn"
        onClick={() => submit()}
        disabled={!value.trim() || seeds.length >= MAX_TASTE_SEEDS}
        data-testid="button-add-artist-seed"
      >
        Add
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// SeedBar — chip row for existing seeds, plus an inline SeedInput to add more.
// ---------------------------------------------------------------------------
export function SeedBar({
  seeds,
  onAddSeed,
  onRemoveSeed,
}: {
  seeds: string[];
  onAddSeed: (artist: string) => void;
  onRemoveSeed: (artist: string) => void;
}) {
  return (
    <div className="seed-bar">
      <span className="seed-bar__label">Tuned for</span>
      <div className="seed-bar__chips">
        {seeds.map((s) => (
          <span key={s} className="seed-chip seed-chip--sm">
            {s}
            <button
              type="button"
              className="seed-chip__remove"
              aria-label={`Remove ${s}`}
              onClick={() => onRemoveSeed(s)}
              data-testid={`button-remove-artist-${s}`}
            >×</button>
          </span>
        ))}
        {seeds.length < MAX_TASTE_SEEDS && (
          <SeedInput seeds={seeds} onAdd={onAddSeed} placeholder="+ artist" />
        )}
      </div>
    </div>
  );
}
