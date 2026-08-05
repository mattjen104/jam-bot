import { useSocialMode, setSocialEnabled } from "../lib/social";

interface Props {
  /** "strip" = folder-tab above the bottom shell (default)
   *  "topbar" = compact pill sitting inside the topbar row */
  variant?: "strip" | "topbar";
}

export function SocialModeBar({ variant = "strip" }: Props) {
  const { enabled } = useSocialMode();
  const cls =
    variant === "topbar"
      ? "social-mode-bar social-mode-bar--topbar"
      : "social-mode-bar";
  return (
    <div className={cls}>
      <div className="dial-mode" role="group" aria-label="Listening mode">
        <button
          type="button"
          className={`dial-mode__button${!enabled ? " dial-mode__button--active" : ""}`}
          aria-pressed={!enabled}
          aria-label="Solo mode"
          onClick={() => setSocialEnabled(false)}
        >
          Solo
        </button>
        <button
          type="button"
          className={`dial-mode__button${enabled ? " dial-mode__button--active" : ""}`}
          aria-pressed={enabled}
          aria-label="Listening Party"
          onClick={() => setSocialEnabled(true)}
        >
          Listening Party
        </button>
      </div>
    </div>
  );
}
