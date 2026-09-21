/**
 * The small, provider-neutral credit vocabulary used by detail surfaces.
 *
 * API responses have changed a few times while enrichment has been rolling
 * out. Keeping the normalisation here means Song, Album, and the investigation
 * sheet share the same honesty rules: only an id-backed identity is a link and
 * an approximate/text-only fact is always rendered as text.
 */
export type CreditGroup =
  | "performers"
  | "writing"
  | "production"
  | "engineering"
  | "release";

export interface CreditIdentity {
  id: string;
  type: "artist" | "person" | "label" | "work" | "release" | "release-group";
  name: string;
}

export interface CreditFact {
  group: CreditGroup;
  roleGroup: string;
  role: string;
  name: string;
  identity?: CreditIdentity;
  work?: CreditIdentity;
  approximate: boolean;
}

export interface ReleaseLabelFact {
  name: string;
  kind: "label" | "release";
  labelId?: string;
  releaseId?: string;
  releaseGroupId?: string;
  releaseTitle?: string | null;
  releaseDate?: string | null;
  releaseStatus?: string | null;
  country?: string | null;
  catalogNumber?: string | null;
  year?: number | null;
  approximate: boolean;
}

export interface CreditProvenance {
  source?: string | null;
  parserVersion?: string | null;
  fetchedAt?: string | number | null;
  stale?: boolean;
  [key: string]: unknown;
}

export interface CreditPayload {
  credits: CreditFact[];
  labels: ReleaseLabelFact[];
  trackCredits?: Record<string, CreditPayload>;
  trackTitles?: Record<string, string>;
  completeness: "complete" | "partial" | "unknown";
  status: "ready" | "pending" | "partial" | "failed" | "deferred" | "unavailable" | "missing";
  fetchedAt?: string | number | null;
  source?: string | null;
  parserVersion?: string | null;
  stale?: boolean;
  error?: string | null;
  provenance?: CreditProvenance;
}

const GROUPS: Record<string, CreditGroup> = {
  performer: "performers",
  performers: "performers",
  instrument: "performers",
  instruments: "performers",
  writer: "writing",
  writers: "writing",
  composer: "writing",
  composition: "writing",
  producer: "production",
  production: "production",
  engineer: "engineering",
  engineering: "engineering",
  mixer: "engineering",
  mastering: "engineering",
  label: "release",
};

function groupFor(role: string): CreditGroup {
  const normal = role.toLowerCase().trim();
  return GROUPS[normal] ?? (normal.includes("mix") || normal.includes("master")
    ? "engineering"
    : normal.includes("writ") || normal.includes("compos")
      ? "writing"
      : normal.includes("prod")
        ? "production"
        : "performers");
}

function identityFrom(value: unknown, fallbackName: string): CreditIdentity | undefined {
  if (!value || typeof value !== "object") return undefined;
  const item = value as Record<string, unknown>;
  const id = typeof item.id === "string"
    ? item.id
    : typeof item.mbid === "string"
      ? item.mbid
      : typeof item.artistId === "string"
        ? item.artistId
        : undefined;
  const name = typeof item.name === "string" ? item.name : fallbackName;
  const type = item.type;
  if (!id || !name || !["artist", "person", "label", "work", "release", "release-group"].includes(String(type ?? "artist"))) {
    return undefined;
  }
  return { id, name, type: (type ?? "artist") as CreditIdentity["type"] };
}

/** Convert either the new credit payload or the existing knowledge response. */
export function normalizeCreditPayload(input: unknown): CreditPayload {
  if (Array.isArray(input)) return normalizeCreditPayload({ credits: input });
  if (!input || typeof input !== "object") {
    return { credits: [], labels: [], completeness: "unknown", status: "missing" };
  }
  const value = input as Record<string, any>;
  const source = value.knowledge && typeof value.knowledge === "object" ? value.knowledge : value;
  const rawCredits = Array.isArray(source.credits)
    ? source.credits
    : Array.isArray(source.personnel)
      ? source.personnel
      : [];
  const credits: CreditFact[] = rawCredits.flatMap((raw: any) => {
    const role = String(raw.role ?? raw.roleGroup ?? raw.roles?.[0] ?? "credit").trim();
    const name = String(raw.name ?? raw.creditedName ?? raw.artistName ?? "").trim();
    if (!name) return [];
    const identity = identityFrom(raw.identity ?? {
      id: raw.artistId ?? raw.artistMbid,
      type: raw.identityType ?? (raw.artistKind === "person" ? "person" : "artist"),
      name,
    }, name);
    const work = identityFrom(raw.work ?? {
      id: raw.workId ?? raw.workMbid,
      type: "work",
      name: raw.workTitle,
    }, String(raw.workTitle ?? raw.workMbid ?? ""));
    return [{
      group: groupFor(String(raw.roleGroup ?? role)),
      roleGroup: String(raw.roleGroup ?? groupFor(role)),
      role,
      name,
      identity,
      work,
      approximate: Boolean(raw.approximate ?? source.approximate),
    }];
  });

  const rawLabels = Array.isArray(value.labels)
    ? value.labels
    : Array.isArray(value.releases)
      ? value.releases
      : source.pressing?.label
        ? [source.pressing]
      : [];
  const labels: ReleaseLabelFact[] = rawLabels.flatMap((raw: any) => {
    const labelName = String(raw.name ?? raw.labelName ?? raw.label ?? "").trim();
    const releaseName = String(raw.releaseTitle ?? raw.title ?? "").trim();
    const name = labelName || releaseName || (raw.releaseMbid || raw.releaseId ? "Canonical release" : "");
    if (!name) return [];
    return [{
      name,
      kind: labelName ? "label" : "release",
      labelId: raw.labelId ?? raw.labelMbid ?? undefined,
      releaseId: raw.releaseId ?? raw.releaseMbid ?? undefined,
      releaseGroupId: raw.releaseGroupId ?? raw.releaseGroupMbid ?? undefined,
      releaseTitle: raw.releaseTitle ?? raw.title ?? null,
      releaseDate: raw.releaseDate ?? null,
      releaseStatus: raw.releaseStatus ?? raw.status ?? null,
      country: raw.country ?? null,
      catalogNumber: raw.catalogNumber ?? null,
      year: raw.year ?? (typeof raw.releaseDate === "string" ? Number(raw.releaseDate.slice(0, 4)) || null : null),
      approximate: Boolean(raw.approximate ?? source.approximate ?? (
        labelName ? !raw.labelMbid && !raw.labelId : !raw.releaseMbid && !raw.releaseId
      )),
    }];
  });
  const trackTitles = Array.isArray(value.tracks)
    ? Object.fromEntries(value.tracks.flatMap((track: any) => {
        const id = typeof track.mbid === "string" ? track.mbid : null;
        const title = typeof track.title === "string" ? track.title : null;
        return id && title ? [[id, title]] : [];
      }))
    : undefined;
  const trackCredits = Array.isArray(value.tracks)
    ? Object.fromEntries(value.tracks.flatMap((track: any) => {
        const id = typeof track.mbid === "string" ? track.mbid : null;
         return id ? [[id, normalizeCreditPayload(track.knowledge ?? track)]] : [];
      }))
    : undefined;
  const rawStatus = String(value.status ?? source.status ?? "").toLowerCase();
  const status = rawStatus === "complete" || rawStatus === "ready"
    ? "ready"
    : rawStatus === "pending" || rawStatus === "partial" || rawStatus === "failed" || rawStatus === "deferred" || rawStatus === "unavailable"
      ? rawStatus
      : credits.length || labels.length ? "partial" : "missing";
  const trackIncomplete = Array.isArray(value.tracks) && value.tracks.some((track: any) => {
    const nestedStatus = String(track.status ?? track.attemptStatus ?? track.completeness ?? "").toLowerCase();
    return nestedStatus === "pending" || nestedStatus === "partial" || nestedStatus === "deferred" || nestedStatus === "unavailable" || nestedStatus === "failed";
  });
  const releaseIncomplete = rawLabels.some((release: any) => {
    const nestedStatus = String(release.attemptStatus ?? release.completeness ?? "").toLowerCase();
    return nestedStatus === "pending" || nestedStatus === "partial" || nestedStatus === "deferred" || nestedStatus === "unavailable" || nestedStatus === "failed";
  });
  const explicitlyComplete = rawStatus === "complete" || value.completeness === "complete";
  const incomplete = trackIncomplete || releaseIncomplete || source.approximate === true
    || value.completeness === "partial"
    || ["pending", "partial", "deferred", "unavailable", "failed"].includes(rawStatus);
  const provenance = (value.provenance ?? source.provenance);
  const provenanceObject = provenance && typeof provenance === "object" ? provenance as CreditProvenance : undefined;
  const fetchedAt = value.fetchedAt ?? value.fetchedAtMs ?? source.fetchedAt ?? source.fetchedAtMs ?? provenanceObject?.fetchedAt ?? null;
  const sourceCandidate = typeof value.source === "string" ? value.source : provenanceObject?.source;
  const sourceName = typeof sourceCandidate === "string"
    ? sourceCandidate
    : null;
  const parserVersion = typeof (value.parserVersion ?? provenanceObject?.parserVersion) === "string"
    ? (value.parserVersion ?? provenanceObject?.parserVersion) as string
    : null;
  const honestStatus = incomplete && status === "ready" ? "partial" : status;
  return {
    credits,
    labels,
    trackCredits,
    trackTitles,
    completeness: incomplete ? "partial" : explicitlyComplete ? "complete" : "unknown",
    status: honestStatus,
    fetchedAt,
    source: sourceName,
    parserVersion,
    stale: Boolean(value.stale ?? provenanceObject?.stale ?? false),
    error: typeof value.error === "string" ? value.error : null,
    provenance: provenanceObject,
  };
}

export function groupCredits(credits: CreditFact[]): Array<[CreditGroup, CreditFact[]]> {
  const order: CreditGroup[] = ["performers", "writing", "production", "engineering", "release"];
  return order
    .map((group) => [group, credits.filter((credit) => credit.group === group)] as [CreditGroup, CreditFact[]])
    .filter(([, facts]) => facts.length > 0);
}

export function creditIdentityHref(identity: CreditIdentity): string | null {
  if (identity.type === "label") return creditDiscoveryHref({ labelMbid: identity.id });
  if (identity.type === "artist" || identity.type === "person") {
    return `/credits/artist/${encodeURIComponent(identity.id)}`;
  }
  if (identity.type === "work") return creditDiscoveryHref({ workMbid: identity.id });
  if (identity.type === "release-group") return `/album/${encodeURIComponent(identity.id)}`;
  return null;
}

export function creditDiscoveryHref(filters: {
  artistMbid?: string | null;
  role?: string | null;
  roleGroup?: string | null;
  workMbid?: string | null;
  recordingMbid?: string | null;
  releaseGroupMbid?: string | null;
  labelMbid?: string | null;
  otherArtists?: boolean;
}): string {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(filters)) {
    if (typeof value === "string" && value) query.set(key, value);
    if (key === "otherArtists" && value === true) query.set(key, "true");
  }
  return `/credits?${query.toString()}`;
}

export function isKeptRecording(
  libraryMbids: { mbids?: readonly string[] } | null | undefined,
  mbid: string,
): boolean {
  return libraryMbids?.mbids?.includes(mbid) === true;
}

export function isKeptAlbum(
  libraryMbids: { releaseGroupMbids?: readonly string[] } | null | undefined,
  releaseGroupMbid: string,
): boolean {
  return libraryMbids?.releaseGroupMbids?.includes(releaseGroupMbid) === true;
}