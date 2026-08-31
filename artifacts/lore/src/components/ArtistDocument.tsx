import { useEffect, useMemo, useRef, useState } from "react";
import { X } from "lucide-react";
import { parseArtistDocument } from "../lib/artistDocument";

export interface ArtistDocumentProps {
  artists: string[];
  onSave: (artists: string[]) => Promise<unknown>;
  onClose: () => void;
}

type SaveState = "saved" | "dirty" | "saving" | "error";

export function ArtistDocument({ artists, onSave, onClose }: ArtistDocumentProps) {
  const persistedText = useMemo(() => artists.join("\n"), [artists]);
  const [value, setValue] = useState(persistedText);
  const [saveState, setSaveState] = useState<SaveState>("saved");
  const [error, setError] = useState<string | null>(null);
  const [previousPersistedText, setPreviousPersistedText] = useState(persistedText);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Query-cache updates from the CLI are deliberately reflected in an open
  // document without replacing unsaved edits. Optimistic save/rollback cache
  // changes are acknowledged but leave the submitted draft intact.
  if (persistedText !== previousPersistedText) {
    const previousArtists = previousPersistedText.split("\n").filter(Boolean);
    const previousKeys = new Set(previousArtists.map((artist) => artist.toLocaleLowerCase()));
    const externalAdditions = artists.filter(
      (artist) => !previousKeys.has(artist.toLocaleLowerCase()),
    );
    setPreviousPersistedText(persistedText);
    if (saveState === "saved") {
      setValue(persistedText);
      setError(null);
    } else if (
      (saveState === "dirty" || saveState === "error")
      && externalAdditions.length > 0
    ) {
      const draftKeys = new Set(
        value
          .split(/\r?\n/)
          .map((artist) => artist.trim().toLocaleLowerCase())
          .filter(Boolean),
      );
      const additions = externalAdditions.filter(
        (artist) => !draftKeys.has(artist.toLocaleLowerCase()),
      );
      if (additions.length > 0) {
        const separator = value.length > 0 && !value.endsWith("\n") ? "\n" : "";
        setValue(`${value}${separator}${additions.join("\n")}`);
      }
    }
  }

  useEffect(() => {
    textareaRef.current?.focus();
  }, []);

  const save = async () => {
    const parsed = parseArtistDocument(value);
    if (parsed.error) {
      setError(parsed.error);
      setSaveState("error");
      return;
    }
    setError(null);
    setSaveState("saving");
    try {
      await onSave(parsed.artists);
      setSaveState("saved");
    } catch (cause) {
      setSaveState("error");
      setError(cause instanceof Error ? cause.message : "Couldn't save your artists. Try again.");
    }
  };

  const dirty = value !== persistedText;
  return (
    <section className="artist-document" aria-label="Add artists document" data-testid="artist-document">
      <div className="artist-document__header">
        <div>
          <div className="artist-document__eyebrow">Artist document</div>
          <h2>Add artists</h2>
          <p>One artist per line. Lore uses this list for Radio and your Library.</p>
        </div>
        <button
          type="button"
          className="artist-document__close"
          onClick={onClose}
          aria-label="Close Add artists document"
        >
          <X size={16} aria-hidden="true" />
        </button>
      </div>
      <textarea
        ref={textareaRef}
        className="artist-document__textarea"
        value={value}
        onChange={(event) => {
          setValue(event.target.value);
          setSaveState("dirty");
          setError(null);
        }}
        onKeyDown={(event) => {
          if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "s") {
            event.preventDefault();
            void save();
          }
        }}
        placeholder="Radiohead&#10;Portishead"
        aria-label="Artists, one per line"
        rows={Math.max(4, Math.min(12, artists.length + 2))}
        spellCheck={false}
        autoComplete="off"
        data-testid="artist-document-input"
      />
      <div className="artist-document__footer">
        <span
          className={`artist-document__status artist-document__status--${saveState}`}
          role={saveState === "error" ? "alert" : "status"}
          aria-live={saveState === "error" ? "assertive" : "polite"}
        >
          {error ?? (saveState === "saving" ? "Saving…" : saveState === "dirty" ? "Unsaved changes" : "Saved")}
        </span>
        <button
          type="button"
          className="artist-document__save"
          onClick={() => void save()}
          disabled={!dirty || saveState === "saving"}
          data-testid="artist-document-save"
        >
          {saveState === "saving" ? "Saving…" : "Save artists"}
        </button>
      </div>
    </section>
  );
}