import { config } from "../config.js";
import { logger } from "../logger.js";
import { getCurrentlyPlaying } from "../spotify/client.js";
import {
  extractUrls,
  fetchLinkEvidence,
  type RetrievedLinkEvidence,
} from "./links.js";
import { synthesizeEvidenceAnswer } from "./openrouter.js";

export type EvidenceIdentity =
  | { kind: "recording"; recordingId: string; artistId?: string }
  | { kind: "artist"; artistId: string }
  | { kind: "external"; url: string };

export interface CanonicalEvidence {
  id: string;
  identity: EvidenceIdentity;
  sourceLabel: string;
  sourceUrl: string;
  excerpt: string;
  confidence: "canonical" | "verified" | "user-provided";
  retrievedAt: string;
  freshUntil?: string;
}

export interface EvidenceAnswer {
  text: string;
  evidence: CanonicalEvidence[];
}

export interface AnswerDecision {
  kind: "factual" | "social";
  confidence: number;
}

export interface AnswerDecisionProvider {
  decide(question: string): Promise<AnswerDecision>;
}

const CLEAR_SOCIAL_RE =
  /^(?:hi|hey|hello|thanks?|thank you|bye|goodbye|lol|haha|tell me a joke)\b|(?:\bwhat (?:do you think|should (?:i|we))\b|\bdo you like\b|\brecommend(?:ation|ations)?\b|\b(?:your|my) favou?rite\b|\bshould (?:i|we) listen\b|\bi (?:love|like|hate|prefer|think|feel)\b)/i;
const PROVOCATION_RE =
  /\b(suck|trash|garbage|stupid|idiot|moron|shut up|fuck|shit|awful|terrible)\b/i;

function looksFactual(question: string): boolean {
  const trimmed = question.trim();
  if (!trimmed) return false;
  // Fail closed: only clearly social, opinion, recommendation, and roast turns
  // may use the legacy conversational model. Imperatives, indirect questions,
  // declarative requests, and unknown forms all take the evidence path.
  return !(CLEAR_SOCIAL_RE.test(trimmed) || PROVOCATION_RE.test(trimmed));
}

export const deterministicAnswerDecisionProvider: AnswerDecisionProvider = {
  async decide(question) {
    return looksFactual(question)
      ? { kind: "factual", confidence: 1 }
      : { kind: "social", confidence: 1 };
  },
};

export async function decideAnswerKind(
  question: string,
  provider: AnswerDecisionProvider = deterministicAnswerDecisionProvider,
): Promise<AnswerDecision> {
  const decision = await provider.decide(question);
  if (
    (decision.kind !== "factual" && decision.kind !== "social") ||
    !Number.isFinite(decision.confidence) ||
    decision.confidence < 0 ||
    decision.confidence > 1
  ) {
    return { kind: "factual", confidence: 0 };
  }
  return { kind: decision.kind, confidence: decision.confidence };
}

const LIMITATION =
  "I couldn’t find enough citable evidence to answer that without guessing.";

function linkToEvidence(
  item: RetrievedLinkEvidence,
  index: number,
): CanonicalEvidence {
  return {
    id: `U${index + 1}`,
    identity: { kind: "external", url: item.url },
    sourceLabel: item.label,
    sourceUrl: item.url,
    excerpt: item.excerpt,
    confidence: "user-provided",
    retrievedAt: new Date().toISOString(),
  };
}

interface LoreKnowledgeResponse {
  claims?: Array<{
    text?: unknown;
    sourceLabel?: unknown;
    sourceUrl?: unknown;
    sourceHandle?: unknown;
    verified?: unknown;
  }>;
}

async function loreJson<T>(path: string): Promise<T | null> {
  try {
    const res = await fetch(`${config.LORE_API_BASE}${path}`, {
      signal: AbortSignal.timeout(8_000),
    });
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch (err) {
    logger.warn("Lore evidence lookup failed", { path, error: String(err) });
    return null;
  }
}

async function resolveLoreRecording(track: {
  isrc: string;
  title: string;
  artist: string;
  durationMs?: number;
}): Promise<{ mbid?: string; artistMbid?: string | null } | null> {
  const cached = await loreJson<{ mbid?: string; artistMbid?: string | null }>(
    `/recordings/by-isrc/${encodeURIComponent(track.isrc)}`,
  );
  if (cached?.mbid) return cached;
  try {
    const res = await fetch(`${config.LORE_API_BASE}/recordings/resolve-evidence`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(config.SESSION_SECRET
          ? { "X-Lore-Internal-Secret": config.SESSION_SECRET }
          : {}),
      },
      body: JSON.stringify(track),
      signal: AbortSignal.timeout(12_000),
    });
    if (!res.ok) return null;
    return (await res.json()) as { mbid?: string; artistMbid?: string | null };
  } catch (err) {
    logger.warn("Lore canonical enrichment failed", { error: String(err) });
    return null;
  }
}

function refersToCurrentSubject(question: string): boolean {
  return /\b(this|current|playing|it|they|them|their|he|him|his|she|her|that one|that (song|track|artist)|the (song|track|artist))\b/i.test(
    question,
  );
}

async function loadCurrentLoreEvidence(
  question: string,
): Promise<CanonicalEvidence[]> {
  if (!refersToCurrentSubject(question)) return [];
  const current = await getCurrentlyPlaying().catch(() => null);
  const track = current?.track;
  const isrc = track?.isrc?.trim();
  if (!track || !isrc) return [];

  const identity = await resolveLoreRecording({
    isrc,
    title: track.title,
    artist: track.artist,
    ...(track.durationMs != null
      ? { durationMs: track.durationMs }
      : {}),
  });
  if (!identity?.mbid) return [];

  // This canonical endpoint both reuses published claims and starts Lore's
  // provenance-bearing enrichment pipeline when its evidence is stale/missing.
  const payload = await loreJson<LoreKnowledgeResponse>(
    `/recordings/${encodeURIComponent(identity.mbid)}/knowledge`,
  );
  const now = new Date().toISOString();
  const freshUntil = new Date(Date.now() + 30 * 24 * 60 * 60_000).toISOString();
  return (payload?.claims ?? []).flatMap((claim, index) => {
    if (
      typeof claim.text !== "string" ||
      typeof claim.sourceLabel !== "string" ||
      typeof claim.sourceUrl !== "string" ||
      !/^https?:\/\//i.test(claim.sourceUrl)
    ) {
      return [];
    }
    return [{
      id: `L${index + 1}`,
      identity: {
        kind: "recording" as const,
        recordingId: identity.mbid!,
        ...(identity.artistMbid ? { artistId: identity.artistMbid } : {}),
      },
      sourceLabel: claim.sourceLabel,
      sourceUrl: claim.sourceUrl,
      excerpt: claim.text.slice(0, 2_000),
      confidence: claim.verified === true ? "verified" as const : "canonical" as const,
      retrievedAt: now,
      freshUntil,
    }];
  });
}

function renderCitations(
  answer: string,
  citationIds: string[],
  evidence: CanonicalEvidence[],
): string | null {
  const byId = new Map(evidence.map((item) => [item.id, item]));
  const cleanAnswer = answer.trim();
  const sentenceCount = cleanAnswer.split(/[.!?]+(?:\s|$)/).filter(Boolean).length;
  if (
    !cleanAnswer ||
    cleanAnswer.length > 1_200 ||
    sentenceCount > 4 ||
    /https?:\/\/|<[^>]+\|[^>]+>|\[[A-Z]\d+\]/i.test(cleanAnswer) ||
    !citationIds.length ||
    citationIds.some((id) => !byId.has(id))
  ) {
    return null;
  }
  const unique = [...new Set(citationIds)];
  const sources = unique
    .map((id) => byId.get(id)!)
    .map((item) => `<${item.sourceUrl}|${item.sourceLabel}>`)
    .join(" · ");
  return `${cleanAnswer}\nSources: ${sources}`;
}

export async function answerWithEvidence(
  question: string,
): Promise<EvidenceAnswer> {
  const [links, lore] = await Promise.all([
    fetchLinkEvidence(extractUrls(question)),
    loadCurrentLoreEvidence(question),
  ]);
  const evidence = [
    ...links.map(linkToEvidence),
    ...lore.map((item, index) => ({ ...item, id: `L${index + 1}` })),
  ];
  if (!evidence.length) return { text: LIMITATION, evidence: [] };

  try {
    const result = await synthesizeEvidenceAnswer(question, evidence);
    const rendered = renderCitations(result.answer, result.citationIds, evidence);
    return { text: rendered ?? LIMITATION, evidence };
  } catch (err) {
    logger.warn("Evidence-bound answer failed closed", { error: String(err) });
    return { text: LIMITATION, evidence };
  }
}