import { config } from "../config.js";
import { logger } from "../logger.js";
import { getCurrentlyPlaying } from "../spotify/client.js";
import {
  contentTerms,
  extractUrls,
  fetchLinkEvidence,
  type RetrievedLinkEvidence,
} from "./links.js";
import { synthesizeEvidenceAnswer } from "./openrouter.js";
import type { EvidenceSynthesisResult } from "./openrouter.js";
import { discoverWebSources } from "./web-search.js";

export type EvidenceIdentity =
  | { kind: "recording"; recordingId: string; artistId?: string }
  | { kind: "artist"; artistId: string }
  | {
      kind: "external";
      url: string;
      recordingId?: string;
      artistId?: string;
    };

export interface CanonicalEvidence {
  id: string;
  identity: EvidenceIdentity;
  sourceLabel: string;
  sourceUrl: string;
  excerpt: string;
  page?: number;
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
const RESPONSE_BUDGET_MS = 30_000;

// Discovery sends the question to an external search provider. Only explicitly
// public music-fact forms qualify; unknown questions (including third-person
// listening history) stay local instead of relying on a blacklist of names.
function isPublicMusicFactQuestion(question: string): boolean {
  const text = question.trim();
  if (/\b(?:i|me|my|mine|we|our|ours|you|your|yours)\b|<@|@[a-z0-9_]+/i.test(text)) {
    return false;
  }
  const work = "(?:album|record|song|track|single|recording|ep)";
  return [
    new RegExp(`^where (?:was|were) (?:the |a |an )?${work} recorded\\??$`, "i"),
    new RegExp(`^when (?:was|were) (?:the |a |an )?${work} (?:released|recorded)\\??$`, "i"),
    new RegExp(`^who (?:wrote|produced|performed|mixed|mastered) (?:the |a |an )?${work}\\??$`, "i"),
    /^what (?:album|record|release) was (?:the )?(?:song|track) (?:released )?on\??$/i,
    /^what album was ["“][^"”]{1,100}["”] released on\??$/i,
  ].some((pattern) => pattern.test(text));
}

function linkToEvidence(
  item: RetrievedLinkEvidence,
  index: number,
  prefix = "U",
): CanonicalEvidence[] {
  const passages = item.pagePassages?.map(({ text, page }) => ({ text, page }))
    ?? (item.passages ?? [item.excerpt]).map((text) => ({ text, page: undefined }));
  return passages.map(({ text, page }, passageIndex) => ({
    id: `${prefix}${index + 1}.P${passageIndex + 1}`,
    identity: { kind: "external", url: item.url },
    sourceLabel: item.label,
    sourceUrl: item.url,
    excerpt: text,
    ...(page !== undefined ? { page } : {}),
    confidence: "user-provided",
    retrievedAt: new Date().toISOString(),
  }));
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

interface LoadedLoreEvidence {
  claims: CanonicalEvidence[];
  sourcePassages: CanonicalEvidence[];
}

async function loreJson<T>(path: string, deadline?: AbortSignal): Promise<T | null> {
  try {
    const res = await fetch(`${config.LORE_API_BASE}${path}`, {
      signal: deadline
        ? AbortSignal.any([deadline, AbortSignal.timeout(8_000)])
        : AbortSignal.timeout(8_000),
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
}, deadline?: AbortSignal): Promise<{ mbid?: string; artistMbid?: string | null } | null> {
  const cached = await loreJson<{ mbid?: string; artistMbid?: string | null }>(
    `/recordings/by-isrc/${encodeURIComponent(track.isrc)}`,
    deadline,
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
      signal: deadline
        ? AbortSignal.any([deadline, AbortSignal.timeout(12_000)])
        : AbortSignal.timeout(12_000),
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
  deadline?: AbortSignal,
): Promise<LoadedLoreEvidence> {
  const empty: LoadedLoreEvidence = { claims: [], sourcePassages: [] };
  if (!refersToCurrentSubject(question)) return empty;
  const current = await getCurrentlyPlaying().catch(() => null);
  const track = current?.track;
  const isrc = track?.isrc?.trim();
  if (!track || !isrc) return empty;

  const identity = await resolveLoreRecording({
    isrc,
    title: track.title,
    artist: track.artist,
    ...(track.durationMs != null
      ? { durationMs: track.durationMs }
      : {}),
  }, deadline);
  if (!identity?.mbid) return empty;

  // This canonical endpoint both reuses published claims and starts Lore's
  // provenance-bearing enrichment pipeline when its evidence is stale/missing.
  const payload = await loreJson<LoreKnowledgeResponse>(
    `/recordings/${encodeURIComponent(identity.mbid)}/knowledge`,
    deadline,
  );
  const now = new Date().toISOString();
  const freshUntil = new Date(Date.now() + 30 * 24 * 60 * 60_000).toISOString();
  const validClaims = (payload?.claims ?? []).filter((claim) =>
    typeof claim.text === "string" &&
    typeof claim.sourceLabel === "string" &&
    typeof claim.sourceUrl === "string" &&
    /^https?:\/\//i.test(claim.sourceUrl),
  );
  const claims = validClaims.flatMap((claim, index) => {
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

  // Lore stores paraphrased claims, not the passage they were grounded in.
  // Re-fetch a small number of distinct cited sources through the same bounded,
  // SSRF-checked reader used for user-provided links. Keep these verbatim
  // passages separate so a published paraphrase can never become a fake quote.
  const sourceClaims = validClaims.filter((claim): claim is typeof claim & {
    text: string;
    sourceUrl: string;
  } => typeof claim.text === "string" && typeof claim.sourceUrl === "string");
  const urls = [...new Set(sourceClaims.map((claim) => claim.sourceUrl))].slice(0, 3);
  if (!urls.length || deadline?.aborted) return { claims, sourcePassages: [] };

  const claimHints = sourceClaims.slice(0, 6).map((claim) => claim.text.slice(0, 400));
  let fetched: RetrievedLinkEvidence[];
  try {
    fetched = await fetchLinkEvidence(
      urls,
      [question, ...claimHints].join("\n"),
    );
  } catch (err) {
    logger.warn("Lore source passage lookup failed", { error: String(err) });
    return { claims, sourcePassages: [] };
  }

  const sourcePassages = fetched.flatMap((item, index) =>
    linkToEvidence(item, index, "R").map((passage) => ({
      ...passage,
      identity: {
        kind: "external" as const,
        url: passage.sourceUrl,
        recordingId: identity.mbid!,
        ...(identity.artistMbid ? { artistId: identity.artistMbid } : {}),
      },
      confidence: "verified" as const,
    })),
  );
  return { claims, sourcePassages };
}

function renderCitations(
  result: EvidenceSynthesisResult,
  evidence: CanonicalEvidence[],
  question: string,
): string | null {
  if (result.status !== "verified" || result.claims.length < 1 || result.claims.length > 4) return null;
  const byId = new Map(evidence.map((item) => [item.id, item]));
  const lines: string[] = [];
  for (const claim of result.claims) {
    const text = claim.text.trim();
    let displayedText = text;
    if (
      !text || text.length > 300 ||
      /https?:\/\/|<[^>]+>|\[[A-Z]\d+(?:\.P\d+)?\]/i.test(text) ||
      !Array.isArray(claim.citations) || !claim.citations.length || claim.citations.length > 3
    ) return null;
    const refs: string[] = [];
    for (const citation of claim.citations) {
      const source = byId.get(citation.id);
      const requestedQuote = citation.quote.trim();
      if (!source || requestedQuote.length < 12 || requestedQuote.length > 240 ||
          /[\r\n]/.test(requestedQuote)) return null;
      // HTML extraction can leave a space before a punctuation mark; models
      // routinely remove it. Restore the precise substring from the page
      // rather than printing a normalized quote that was never retrieved.
      const pattern = [...requestedQuote].map((char) =>
        char === " " ? "\\s+" :
        /[.,;:!?]/.test(char) ? `\\s*\\${char}` :
        char.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
      ).join("");
      const quote = source.excerpt.match(new RegExp(pattern))?.[0];
      if (!quote || /[\r\n]/.test(quote)) return null;
      // If the model paraphrases a real quote, display the source's words
      // instead. Never display the model's uncited wording. Reject added facts
      // outside both the passage and the question (e.g. London vs Paris).
      if (source.identity.kind === "external") {
        const quoteTerms = contentTerms(quote);
        const questionTerms = contentTerms(question);
        if ([...contentTerms(text)].some((term) =>
          !quoteTerms.has(term) && !questionTerms.has(term)
        )) return null;
        if (displayedText !== text && displayedText !== quote) return null;
        displayedText = quote;
      }
      // A real quote on an unrelated page is not proof for an arbitrary claim.
      // Require substantive lexical overlap, but allow paraphrases when two
      // distinctive content terms are shared.
      const claimTerms = contentTerms(text);
      const quoteTerms = contentTerms(quote);
      if ([...claimTerms].filter((term) => quoteTerms.has(term)).length < 2) return null;
      // Shared nouns alone cannot prove a proposition: "was not recorded
      // live" shares every content term with "was recorded live".
      const negated = (value: string) =>
        /\b(?:not|no|never|without|neither|nor|didn't|doesn't|wasn't|weren't|isn't|aren't|hasn't|haven't|cannot|can't)\b/i.test(value);
      if (negated(text) !== negated(quote)) return null;
      const numbers = (value: string): string[] => value.match(/\b\d+(?:[.,]\d+)*\b/g) ?? [];
      if (numbers(text).some((number) => !numbers(quote).includes(number))) return null;
      // Do not let a model select the affirmative half of an explicitly
      // contradictory passage pair. Other kinds of conflict are handled by
      // the model's unverified status, never by choosing a "better" source.
      const opposite = /\b(?:is|was|were|are|has|have|had|did|does|can|will) not\b/i.test(quote)
        ? quote.replace(/\b(is|was|were|are|has|have|had|did|does|can|will) not\b/i, "$1")
        : quote.replace(/\b(is|was|were|are|has|have|had|did|does|can|will)\b/i, "$1 not");
      if (opposite !== quote && evidence.some((item) =>
        item.id !== source.id && item.excerpt.toLowerCase().includes(opposite.toLowerCase())
      )) return null;
      if (source.identity.kind === "external" && evidence.some((item) => {
        if (item.id === source.id || item.identity.kind !== "external") return false;
        const otherTerms = contentTerms(item.excerpt);
        const shared = [...quoteTerms].filter((term) => otherTerms.has(term)).length;
        // A competing passage about the same subject with different material
        // details is not something the bot can reconcile under this deadline.
        return shared >= 2 &&
          shared / Math.max(quoteTerms.size, otherTerms.size) >= 0.6 &&
          [...quoteTerms].some((term) => !otherTerms.has(term)) &&
          [...otherTerms].some((term) => !quoteTerms.has(term));
      })) return null;
      const safeLabel = source.sourceLabel.replace(/[<>&|]/g, " ").slice(0, 80);
      const safeQuote = quote.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
      refs.push(source.identity.kind === "external"
        ? `<${source.sourceUrl}|${safeLabel}> (${source.page ? `p. ${source.page}; ` : ""}“${safeQuote}”)`
        : `<${source.sourceUrl}|${safeLabel}> (Lore-published claim; source passage not checked)`);
    }
    lines.push(`${displayedText} ${refs.join(" · ")}`);
  }
  return lines.join("\n");
}

export async function answerWithEvidence(
  question: string,
): Promise<EvidenceAnswer> {
  const started = Date.now();
  const deadline = AbortSignal.timeout(RESPONSE_BUDGET_MS);
  const pastedUrls = extractUrls(question);
  const [links, lore, discovered] = await Promise.all([
    fetchLinkEvidence(pastedUrls, question),
    loadCurrentLoreEvidence(question, deadline),
    pastedUrls.length || !isPublicMusicFactQuestion(question)
      ? Promise.resolve([])
      : discoverWebSources(question, deadline),
  ]);
  const webLinks = discovered.length
    ? await fetchLinkEvidence(discovered, question)
    : [];
  const evidence = [
    ...links.flatMap((item, index) => linkToEvidence(item, index)),
    ...webLinks.flatMap((item, index) => linkToEvidence(item, index, "W")),
    ...lore.claims.map((item, index) => ({ ...item, id: `L${index + 1}` })),
    ...lore.sourcePassages,
  ];
  if (!evidence.length) return { text: LIMITATION, evidence: [] };

  try {
    // Discovery, page retrieval, and synthesis share one response budget.
    // Leave enough time for a searched page to be read before synthesis.
    const remaining = Math.max(0, RESPONSE_BUDGET_MS - (Date.now() - started));
    if (remaining < 500) return { text: LIMITATION, evidence };
    const result = await synthesizeEvidenceAnswer(question, evidence, remaining);
    const rendered = renderCitations(result, evidence, question);
    return { text: rendered ?? LIMITATION, evidence };
  } catch (err) {
    logger.warn("Evidence-bound answer failed closed", { error: String(err) });
    return { text: LIMITATION, evidence };
  }
}
