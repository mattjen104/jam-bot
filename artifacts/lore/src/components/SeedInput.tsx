import { useState } from "react";

// ---------------------------------------------------------------------------
// SeedInput — single-line artist-name input with an Add button.
// Used by DialView's onboarding placeholder and the Library empty state.
// ---------------------------------------------------------------------------
export function SeedInput({
  seeds,
  onAdd,
  placeholder = "e.g. Radiohead",
}: {
  seeds: string[];
  onAdd: (artist: string) => void;
  placeholder?: string;
}) {
  const [value, setValue] = useState("");

  const submit = () => {
    const trimmed = value.trim();
    if (!trimmed) return;
    onAdd(trimmed);
    setValue("");
  };

  return (
    <div className="seed-input-row">
      <input
        className="seed-input"
        type="text"
        placeholder={placeholder}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); submit(); } }}
        maxLength={100}
        autoComplete="off"
        autoCorrect="off"
        spellCheck={false}
        aria-label="Artist name"
      />
      <button
        type="button"
        className="seed-add-btn"
        onClick={submit}
        disabled={!value.trim() || seeds.length >= 10}
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
            >×</button>
          </span>
        ))}
        {seeds.length < 10 && (
          <SeedInput seeds={seeds} onAdd={onAddSeed} placeholder="+ artist" />
        )}
      </div>
    </div>
  );
}
