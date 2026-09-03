import type { ImportJobStatus } from "./meHooks";
import type { DialSpin } from "../hooks/useDialData";

export type AdaptiveListeningState =
  | "cold"
  | "importing"
  | "resolving"
  | "crossing-ready"
  | "established";

export interface AdaptiveListeningInput {
  hasLibrary: boolean;
  hasSeeds: boolean;
  importJob?: Pick<ImportJobStatus, "status" | "phase" | "total" | "resolved"> | null;
  confirmedLiveCrossings: number;
}

export interface AdaptiveListeningCopy {
  eyebrow: string;
  title: string;
  description: string;
}

export function isConfirmedCrossing(track: Pick<DialSpin, "isLibraryHit" | "isArtistHit" | "resolving"> | null | undefined): boolean {
  return Boolean(track && !track.resolving && (track.isLibraryHit || track.isArtistHit));
}

export function deriveAdaptiveListeningState(input: AdaptiveListeningInput): AdaptiveListeningState {
  const jobIsActive = input.importJob?.status === "running" || input.importJob?.status === "pending";
  if (jobIsActive) return input.importJob?.phase === "resolve" ? "resolving" : "importing";
  if (input.confirmedLiveCrossings > 0) return "crossing-ready";
  if (input.hasLibrary || input.hasSeeds) return "established";
  return "cold";
}

export function adaptiveListeningCopy(state: AdaptiveListeningState): AdaptiveListeningCopy {
  switch (state) {
    case "cold":
      return {
        eyebrow: "Start with live radio",
        title: "Choose a door into the dial.",
        description: "A few strong stations are ready now. You can browse the full Feed whenever you want.",
      };
    case "importing":
      return {
        eyebrow: "Your Stack is arriving",
        title: "Live radio now; matching as it goes.",
        description: "Your partial library is already useful. Matching continues without hiding the stations you can hear.",
      };
    case "resolving":
      return {
        eyebrow: "Matching your Stack",
        title: "We’re finding your records on air.",
        description: "Some matches are ready while the rest resolve. Nothing provisional is presented as a crossing.",
      };
    case "crossing-ready":
      return {
        eyebrow: "Confirmed on air",
        title: "Your records are playing right now.",
        description: "Start with an exact crossing, then explore the wider dial without interrupting playback.",
      };
    case "established":
      return {
        eyebrow: "Your listening surface",
        title: "Find the next good broadcast.",
        description: "Recent matches and strong station overlap lead the way; the full Feed holds everything else.",
      };
  }
}

export function importProgressLabel(job: AdaptiveListeningInput["importJob"]): string | null {
  if (!job || (job.status !== "running" && job.status !== "pending")) return null;
  if (job.total <= 0) return "Matching your Stack · progress will appear as tracks resolve";
  return `Matching your Stack · ${job.resolved.toLocaleString()} of ${job.total.toLocaleString()} tracks resolved`;
}