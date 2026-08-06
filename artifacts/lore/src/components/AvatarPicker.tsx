import { HALLOWEEN_AVATARS, emojiSvgUrl } from "../lib/twemoji";

interface AvatarPickerProps {
  selected: string | null;
  onSelect: (emoji: string) => void;
}

/**
 * 12 Halloween avatars in a 3×4 inline grid.
 * Each rendered as a Twemoji SVG image (cross-platform emoji consistency).
 */
export function AvatarPicker({ selected, onSelect }: AvatarPickerProps) {
  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "repeat(4, 1fr)",
        gap: 6,
        padding: "8px 0",
      }}
      role="radiogroup"
      aria-label="Choose your avatar"
    >
      {HALLOWEEN_AVATARS.map((emoji) => {
        const isSelected = emoji === selected;
        return (
          <button
            key={emoji}
            type="button"
            role="radio"
            aria-checked={isSelected}
            aria-label={emoji}
            onClick={() => onSelect(emoji)}
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              width: 40,
              height: 40,
              borderRadius: 8,
              border: isSelected
                ? "2px solid var(--picker, #8f8f8f)"
                : "1.5px solid transparent",
              background: isSelected
                ? "var(--picker-bg, rgba(143, 143, 143,0.12))"
                : "var(--surface-2, rgba(255, 255, 255,0.04))",
              cursor: "pointer",
              padding: 4,
              transition: "border-color 0.15s, background 0.15s",
            }}
          >
            <img
              src={emojiSvgUrl(emoji)}
              width={28}
              height={28}
              alt={emoji}
              draggable={false}
            />
          </button>
        );
      })}
    </div>
  );
}
