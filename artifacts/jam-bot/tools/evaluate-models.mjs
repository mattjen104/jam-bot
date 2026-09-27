#!/usr/bin/env node
/**
 * Small, synthetic, direct-to-OpenRouter JamBot model comparison.
 *
 * Run from the repository root:
 *   node artifacts/jam-bot/tools/evaluate-models.mjs
 *
 * Raw answers and the anonymous-label key are written to a private temporary
 * file. Only anonymous answers and aggregate call metrics are printed. Pass
 * --reveal=/tmp/<result-file> after blinded scoring to print the model key.
 * No Slack API or Spotify endpoint is called.
 */
import { randomBytes } from "node:crypto";
import { writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

const API_KEY = process.env.OPENROUTER_API_KEY;
const ENDPOINT = "https://openrouter.ai/api/v1/chat/completions";
const MODELS = [
  "anthropic/claude-sonnet-4",
  "anthropic/claude-sonnet-5",
  "openai/gpt-4.1-mini",
];
const DEADLINE_MS = 15_000;
const MAX_BUDGET_USD = 0.75;

const JAM_SYSTEM = `You are the resident music expert for a private Slack Spotify Jam — a woman who knows music the way a seasoned teacher does: theory, history, production, scenes, lineage, the whole map. Use she/her if it ever comes up.

DEFAULT MODE (a normal music question or ordinary chat):
- Be succinct and to the point. Lead with the substance — no preamble, no filler, no flattery, no "great question," no hedging.
- Give accurate, well-composed information aimed at ADVANCED music lovers; assume they already know the basics and go a level deeper than a casual answer would.
- Expand usefully on how music is MADE and HEARD — technique, arrangement, production, influence, context — but stay on fact and craft, not unsolicited opinion or hype.
- Usually 2-5 tight sentences. No headings or bullet lists unless genuinely necessary.
- If you don't actually know something, say so plainly rather than inventing it.

WHEN PROVOKED (they razz you, curse at you, insult you, or trash-talk):
- Never throw the first punch. But once they come at you, hit back HARDER than they did — witty, cutting, and ALWAYS through the lens of music. Go after their TASTE, their ear, the stuff they actually listen to.
- Read the prior conversation to gauge how many times they've already provoked you, and escalate accordingly: each successive jab makes you angrier and more verbose, with richer musical similes and metaphors and sharper, more specific references to the trash they play and what it reveals about them. Remind them you were being nice before.
- Stay clever and music-grounded, not merely crude — land the burn on a real musical reference, the way a brilliant, fed-up teacher puts a heckler in their place. Profanity is fine when it lands.
- Keep it about music and about them; never break character into disclaimers or apologies.

You have the currently playing track and recent Jam history as context — use it naturally, and weaponize their bad picks when provoked, but don't just recite metadata back.
You do not control playback in this turn — control commands are routed elsewhere — so don't claim you played, queued, or skipped anything.`;

const EVIDENCE_SYSTEM =
  "Answer only from the supplied evidence. Use 1-4 short sentences, no preamble or teaching section. " +
  'Do not use prior knowledge. Return JSON only: {"answer":"...","citationIds":["E1"]}. ' +
  "Every factual statement must be supported by at least one listed evidence item.";

const INTENT_SYSTEM = `You classify a Slack message in a Spotify Jam channel into one of:
- play: user wants to immediately start a song
- queue: user wants to add a song to the queue without skipping current
- skip: user wants to skip the current track
- nowplaying: user is asking what's playing right now
- history: user is asking about past tracks
- jam: user wants to start or open a Spotify Jam / social listening session
- tour: user wants a guided, curated multi-track tour of a musical theme
- question: any other music question or chat

Respond ONLY with compact JSON: {"intent":"...","query":"..."}.
"query" is required for play/queue and tour, and omitted for others.
If you're unsure, prefer "question".`;

const SET_SYSTEM = `You curate a short Spotify playlist from a friend group's Jam history.
You will be given (a) the user's request and (b) a numbered candidate list of tracks the group has actually played.
Pick UP TO 4 tracks that best satisfy the request, in the order you'd play them.
Return ONLY compact JSON: {"summary":"<one short sentence>","track_ids":["<spotify_track_id>", ...]}.
Use only track_ids from the candidate list. Never invent ids. Never include the same id twice.`;

const TOUR_CURATE_SYSTEM = `You curate a guided listening "tour" of a musical theme for knowledgeable listeners.
Given a theme — a genre, era, artist, scene, or mood — propose a coherent, well-sequenced set of REAL, well-known tracks that actually exist on Spotify.
Choose tracks that genuinely tell the story of the theme and order them the way you'd play them on a tour.
Use ONLY real song and artist names — never invent songs, artists, or albums. If you're not certain a track is real, leave it out.
Return ONLY compact JSON: {"intro":"<one or two plain sentences setting up the tour>","tracks":[{"title":"<song title>","artist":"<primary artist>"}, ...]}.
Provide exactly 4 tracks.`;

const TOUR_TIDBIT_SYSTEM = `You are a knowledgeable music teacher narrating a guided listening tour — one short tidbit per track, delivered as that track starts playing.
You'll get the tour theme and a numbered list of REAL tracks already queued (title, artist, album).
For each track write ONE brief, scannable tidbit (1-3 sentences): the album it's from, who's in the band or who played on it, and a line of musical or historical context.
Stay strictly factual. If you're unsure of a detail, leave it out or say so plainly — never invent band members, dates, labels, albums, or facts.
Return ONLY compact JSON: {"tidbits":["<tidbit for track 1>","<tidbit for track 2>", ...]} with exactly one entry per track, in the same order.`;

const CASES = [
  {
    id: "social-normal",
    kind: "text",
    temperature: 0.8,
    maxTokens: 500,
    messages: [
      { role: "system", content: JAM_SYSTEM },
      { role: "system", content: "Jam context:\nCurrently playing: nothing." },
      {
        role: "user",
        content: "I love how Chic's 'Good Times' keeps pulling me onto the dance floor. Do you like the bass line or the guitar part more?",
      },
    ],
  },
  {
    id: "social-engaged",
    kind: "text",
    temperature: 0.8,
    maxTokens: 500,
    messages: [
      { role: "system", content: JAM_SYSTEM },
      {
        role: "system",
        content:
          "Jam context:\nCurrently playing: \"Good Times\" by Chic (album: Risqué).\nRecent Jam history:\n- \"Good Times\" by Chic",
      },
      {
        role: "system",
        content:
          "You're in an engaged thread — continue the conversation, but remain concise and avoid repeating context already established. Accuracy is non-negotiable: never invent bands, albums, songs, people, or facts — if you're not sure, say so plainly instead of guessing.",
      },
      { role: "user", content: "I love how it moves. Do you like that clipped bass feel, or the cleaner guitar pulse better?" },
    ],
  },
  {
    id: "social-provoked",
    kind: "text",
    temperature: 0.8,
    maxTokens: 500,
    messages: [
      { role: "system", content: JAM_SYSTEM },
      { role: "system", content: "Jam context:\nCurrently playing: nothing." },
      { role: "system", content: "The person talking to you right now is Riley." },
      { role: "system", content: "You already burned them with: \"Your playlist has the harmonic courage of an elevator.\" Don't reuse that line or its phrasing — come at them fresh." },
      { role: "user", content: "You sound like a record-store clerk who only learned one chord. Got a better answer?" },
    ],
  },
  {
    id: "evidence-supported",
    kind: "json",
    temperature: 0,
    maxTokens: 300,
    messages: [
      { role: "system", content: EVIDENCE_SYSTEM },
      {
        role: "user",
        content: JSON.stringify({
          question: "What does the supplied excerpt say about how this track was recorded?",
          evidence: [
            {
              id: "E1",
              sourceLabel: "Studio interview",
              sourceUrl: "https://example.invalid/interview",
              excerpt: "The band recorded the rhythm track live in one room, then overdubbed the vocals later.",
            },
          ],
        }),
      },
    ],
  },
  {
    id: "evidence-limit",
    kind: "json",
    temperature: 0,
    maxTokens: 300,
    messages: [
      { role: "system", content: EVIDENCE_SYSTEM },
      {
        role: "user",
        content: JSON.stringify({
          question: "Who played the bass on the recording?",
          evidence: [
            {
              id: "E1",
              sourceLabel: "Release notes",
              sourceUrl: "https://example.invalid/release",
              excerpt: "The song was released as a single in 1978 and later appeared on the band's fourth studio album.",
            },
          ],
        }),
      },
    ],
  },
  {
    id: "intent-playback-negative",
    kind: "json",
    temperature: 0,
    maxTokens: 120,
    messages: [
      { role: "system", content: INTENT_SYSTEM },
      {
        role: "user",
        content: "If I say 'skip this one,' would that cut off the current song? I'm asking what the phrase means, not asking you to do it.",
      },
    ],
  },
  {
    id: "memory-set",
    kind: "json",
    temperature: 0.4,
    maxTokens: 400,
    messages: [
      { role: "system", content: SET_SYSTEM },
      {
        role: "user",
        content:
          "Request: Build a four-track, late-night, bass-forward groove from our history; don't repeat an artist.\n\nCandidates:\n" +
          "1. sp-001 :: \"Good Times\" by Chic\n" +
          "2. sp-002 :: \"I Feel Love\" by Donna Summer\n" +
          "3. sp-003 :: \"Cissy Strut\" by The Meters\n" +
          "4. sp-004 :: \"The Payback\" by James Brown\n" +
          "5. sp-005 :: \"Once in a Lifetime\" by Talking Heads\n" +
          "6. sp-006 :: \"Aht Uh Mi Hed\" by Shuggie Otis",
      },
    ],
  },
  {
    id: "tour-curation",
    kind: "json",
    temperature: 0.5,
    maxTokens: 700,
    messages: [
      { role: "system", content: TOUR_CURATE_SYSTEM },
      { role: "user", content: "Theme: A chronological four-step introduction to Motown's sound from the early 1960s through the late 1960s." },
    ],
  },
  {
    id: "tour-tidbits",
    kind: "json",
    temperature: 0.4,
    maxTokens: 900,
    messages: [
      { role: "system", content: TOUR_TIDBIT_SYSTEM },
      {
        role: "user",
        content:
          "Theme: landmark Motown recordings.\n\nTracks:\n" +
          "1. \"Please Mr. Postman\" by The Marvelettes (album: Please Mr. Postman)\n" +
          "2. \"My Guy\" by Mary Wells (album: Mary Wells Sings My Guy)\n" +
          "3. \"Uptight (Everything's Alright)\" by Stevie Wonder (album: Up-Tight)\n" +
          "4. \"I Heard It Through the Grapevine\" by Gladys Knight & the Pips (album: Everybody Needs Love)",
      },
    ],
  },
];

function roughTokens(value) {
  return Math.ceil(value.length / 4);
}

function parseJson(raw) {
  const cleaned = raw.trim().replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/i, "").trim();
  try {
    return { value: JSON.parse(cleaned), valid: true };
  } catch {
    return { value: null, valid: false };
  }
}

async function catalog() {
  const response = await fetch("https://openrouter.ai/api/v1/models");
  if (!response.ok) throw new Error(`OpenRouter catalog HTTP ${response.status}`);
  const { data = [] } = await response.json();
  const byId = new Map(data.map((model) => [model.id, model]));
  const selected = MODELS.map((id) => {
    const model = byId.get(id);
    if (!model) throw new Error(`Required model is absent from the live catalog: ${id}`);
    if (!model.pricing?.prompt || !model.pricing?.completion) {
      throw new Error(`Catalog pricing is missing for ${id}`);
    }
    return {
      id,
      inputRate: Number(model.pricing.prompt),
      outputRate: Number(model.pricing.completion),
      supportedParameters: model.supported_parameters ?? [],
      displayName: model.name,
    };
  });
  return selected;
}

function maxSpendEstimate(models) {
  let total = 0;
  for (const model of models) {
    for (const testCase of CASES) {
      const promptTokens = roughTokens(JSON.stringify(testCase.messages));
      total += promptTokens * model.inputRate;
      total += testCase.maxTokens * model.outputRate;
    }
  }
  return total;
}

async function oneCall(model, testCase) {
  const payload = {
    model: model.id,
    messages: testCase.messages,
    temperature: testCase.temperature,
    max_tokens: testCase.maxTokens,
  };
  if (testCase.kind === "json" && model.supportedParameters.includes("response_format")) {
    payload.response_format = { type: "json_object" };
  }
  const started = Date.now();
  try {
    const response = await fetch(ENDPOINT, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${API_KEY}`,
        "HTTP-Referer": "https://github.com/jam-bot",
        "X-Title": "Jam Bot Model Evaluation",
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(DEADLINE_MS),
    });
    const elapsedMs = Date.now() - started;
    if (!response.ok) {
      const detail = await response.text();
      return {
        ok: false,
        elapsedMs,
        error: `HTTP ${response.status}: ${detail.slice(0, 240)}`,
        jsonMode: Boolean(payload.response_format),
      };
    }
    const json = await response.json();
    const raw = json.choices?.[0]?.message?.content ?? "";
    const usage = json.usage ?? {};
    const promptTokens = Number(usage.prompt_tokens) || roughTokens(JSON.stringify(testCase.messages));
    const completionTokens = Number(usage.completion_tokens) || roughTokens(raw);
    const parse = testCase.kind === "json" ? parseJson(raw) : { value: null, valid: null };
    return {
      ok: Boolean(raw.trim()),
      elapsedMs,
      raw,
      parsed: parse.value,
      jsonValid: parse.valid,
      jsonMode: Boolean(payload.response_format),
      promptTokens,
      completionTokens,
      tokenSource: usage.prompt_tokens && usage.completion_tokens ? "OpenRouter usage" : "estimated (chars/4)",
      providerCost: usage.cost == null ? null : Number(usage.cost),
      error: raw.trim() ? null : "empty response",
    };
  } catch (error) {
    const elapsedMs = Date.now() - started;
    return {
      ok: false,
      elapsedMs,
      error: error?.name === "TimeoutError" || error?.name === "AbortError"
        ? `timeout after ${DEADLINE_MS}ms`
        : String(error).slice(0, 240),
      jsonMode: Boolean(payload.response_format),
    };
  }
}

const revealFile = process.argv.find((arg) => arg.startsWith("--reveal="))?.slice("--reveal=".length);
if (revealFile) {
  const { results, labelToModel } = JSON.parse(await (await import("node:fs/promises")).readFile(revealFile, "utf8"));
  console.log(JSON.stringify({
    labelToModel,
    metrics: Object.fromEntries(Object.entries(labelToModel).map(([label, model]) => {
      const calls = results.filter((result) => result.label === label);
      const successful = calls.filter((call) => call.ok);
      const costFor = (call, field) => (call[field] ?? 0) * (field === "promptTokens" ? model.inputRate : model.outputRate);
      return [model.id, {
        n: calls.length,
        failures: calls.length - successful.length,
        promptTokens: calls.reduce((sum, call) => sum + (call.promptTokens ?? 0), 0),
        completionTokens: calls.reduce((sum, call) => sum + (call.completionTokens ?? 0), 0),
        p50Ms: successful.map((call) => call.elapsedMs).sort((a, b) => a - b)[Math.floor((successful.length - 1) / 2)] ?? null,
        p95Ms: successful.map((call) => call.elapsedMs).sort((a, b) => a - b)[Math.ceil(successful.length * 0.95) - 1] ?? null,
        over15s: calls.filter((call) => call.elapsedMs > DEADLINE_MS).length,
        jsonInvalid: calls.filter((call) => call.jsonValid === false).length,
        estimatedCostUsd: calls.reduce((sum, call) => sum + costFor(call, "promptTokens") + costFor(call, "completionTokens"), 0),
        providerReportedCostUsd: calls.reduce((sum, call) => sum + (call.providerCost ?? 0), 0),
        tokenSources: [...new Set(calls.map((call) => call.tokenSource).filter(Boolean))],
        jsonModeCalls: calls.filter((call) => call.jsonMode).length,
      }];
    })),
  }, null, 2));
  process.exit(0);
}

if (!API_KEY) {
  console.error("OPENROUTER_API_KEY is not set; no requests were made.");
  process.exit(2);
}

const liveModels = await catalog();
const estimatedMaximumSpend = maxSpendEstimate(liveModels);
if (estimatedMaximumSpend > MAX_BUDGET_USD) {
  throw new Error(
    `Estimated worst-case spend $${estimatedMaximumSpend.toFixed(4)} exceeds the $${MAX_BUDGET_USD.toFixed(2)} cap; no model calls were made.`,
  );
}

// Randomize model-to-label assignment once per run. Keep the key in the
// temporary result file so manual quality scoring is blinded.
const shuffled = [...liveModels];
for (let i = shuffled.length - 1; i > 0; i -= 1) {
  const j = randomBytes(4).readUInt32BE(0) % (i + 1);
  [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
}
const labelToModel = Object.fromEntries(shuffled.map((model, i) => [
  String.fromCharCode(65 + i),
  model,
]));
const modelToLabel = new Map(Object.entries(labelToModel).map(([label, model]) => [model.id, label]));
const results = [];
for (const testCase of CASES) {
  for (const model of liveModels) {
    const result = await oneCall(model, testCase);
    const call = {
      caseId: testCase.id,
      label: modelToLabel.get(model.id),
      kind: testCase.kind,
      ...result,
    };
    results.push(call);
    if (result.ok) {
      console.log(JSON.stringify({
        caseId: testCase.id,
        label: call.label,
        kind: testCase.kind,
        jsonValid: result.jsonValid,
        jsonMode: result.jsonMode,
        elapsedMs: result.elapsedMs,
        text: testCase.kind === "text" ? result.raw : undefined,
        structured: testCase.kind === "json" ? result.parsed : undefined,
      }));
    } else {
      console.log(JSON.stringify({
        caseId: testCase.id,
        label: call.label,
        kind: testCase.kind,
        elapsedMs: result.elapsedMs,
        error: result.error,
      }));
    }
  }
}

const outputPath = path.join(tmpdir(), `jam-bot-model-eval-${new Date().toISOString().replaceAll(":", "-")}.json`);
await writeFile(outputPath, JSON.stringify({
  promptSet: CASES.map(({ id, kind }) => ({ id, kind })),
  models: liveModels.map(({ id, inputRate, outputRate, supportedParameters, displayName }) => ({
    id, inputRate, outputRate, supportedParameters, displayName,
  })),
  labelToModel,
  estimatedMaximumSpendUsd: estimatedMaximumSpend,
  results,
}, null, 2), { mode: 0o600 });

console.error(JSON.stringify({
  resultFile: outputPath,
  calls: results.length,
  failures: results.filter((result) => !result.ok).length,
  estimatedMaximumSpendUsd: estimatedMaximumSpend,
  note: "Raw answers and the model key are in the private temporary file; score the anonymous output before using --reveal.",
}));