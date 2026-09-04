export const MONITORED_TRIAL_DAYS = 7;

export type MonitoredTrial = {
  kind: "soundtap_candidate";
  startedAt: string;
  endsAt: string;
};

export function readMonitoredTrial(
  config: Record<string, unknown> | null | undefined,
): MonitoredTrial | null {
  const value = config?.monitoredTrial;
  if (!value || typeof value !== "object") return null;
  const trial = value as Partial<MonitoredTrial>;
  if (
    trial.kind !== "soundtap_candidate" ||
    typeof trial.startedAt !== "string" ||
    typeof trial.endsAt !== "string"
  ) return null;
  const start = Date.parse(trial.startedAt);
  const end = Date.parse(trial.endsAt);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return null;
  if (end - start > MONITORED_TRIAL_DAYS * 86_400_000) return null;
  return trial as MonitoredTrial;
}

export function monitoredTrialFromConfig(
  config: Record<string, unknown> | null | undefined,
  now = new Date(),
): MonitoredTrial | null {
  const trial = readMonitoredTrial(config);
  if (!trial) return null;
  const start = Date.parse(trial.startedAt);
  const end = Date.parse(trial.endsAt);
  if (now.getTime() < start || now.getTime() >= end) return null;
  return trial;
}

export function isMonitoredTrialStation(
  station: { hidden: boolean; active?: boolean; nowPlayingConfig: Record<string, unknown> | null },
  now = new Date(),
): boolean {
  return station.hidden && station.active !== false &&
    monitoredTrialFromConfig(station.nowPlayingConfig, now) !== null;
}

export function canStartMonitoredTrial(station: {
  hidden: boolean;
  active?: boolean;
  crossingEligible?: boolean;
  homepageUrl?: string | null;
  streamUrl?: string | null;
  nowPlayingSource?: string | null;
}): boolean {
  return station.hidden &&
    station.active === false &&
    station.crossingEligible === false &&
    !!station.homepageUrl &&
    !!station.streamUrl &&
    !!station.nowPlayingSource;
}