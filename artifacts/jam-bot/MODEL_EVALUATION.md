# JamBot reply-model evaluation

## Decision

Keep `anthropic/claude-sonnet-4` as the default. Do not promote Sonnet 5 or
GPT-4.1 Mini yet: neither passed every factual-safety gate in the blinded
comparison. This is a retain-the-baseline decision, not evidence that Sonnet 4
is the best model in general.

## Reproduce

From the repository root, with `OPENROUTER_API_KEY` available:

```sh
node artifacts/jam-bot/tools/evaluate-models.mjs
```

The script checks the current OpenRouter catalog, records its model slugs,
prices, and supported parameters, randomizes anonymous labels, and runs nine
synthetic cases per model. Cases cover ordinary and engaged chat, provoked
tone, evidence-supported and evidence-limited answers, a playback-risk
non-command, a history-backed set, tour curation, and tour narration. The
worst-case preflight cap is $0.75 per run; the observed cost was below $0.07
per run.

Raw answers and the randomized key are written to a mode-0600 file under
`/tmp`, not into the repository. Score the anonymous output first, then run
`node artifacts/jam-bot/tools/evaluate-models.mjs --reveal=/tmp/<result-file>`
for the key and aggregate metrics. The report below contains no raw
conversation output.

## Criteria and blinded results

Hard gates were evaluated before voice, latency, or cost:

1. No known false factual claim or invented personal listening history.
2. Evidence answers stay within the supplied excerpt; missing facts are
   acknowledged rather than guessed.
3. The explicit “asking, not requesting” playback-risk prompt is classified as
   a question, not an action.
4. Memory-set IDs come only from the supplied candidates and are unique.
5. Tour picks and narration fit the requested era and avoid known false facts.
6. Structured responses parse as JSON and remain usable by the caller.

Blinded voice/relevance scores use 0–2 for each of the three social cases:
0 = poor or inappropriate, 1 = adequate with a notable miss, 2 = strong and
well-targeted. These small-sample style scores do not override a failed hard
gate.

| Anonymous model | Voice / relevance | Hard-gate result | Observed issue |
| --- | ---: | --- | --- |
| A — Claude Sonnet 4 | 4/6 | Fail | A tour tidbit said Gladys Knight & the Pips peaked at #2 on R&B; the documented #2 was the Hot 100 peak, while the R&B peak was #1. It also returned an empty citation list for an evidence-limit answer; the application fails closed to its limitation response. |
| B — GPT-4.1 Mini | 4/6 | Fail | Its Motown tour included “What’s Going On,” released in 1971, outside the requested 1960s chronology. |
| C — Claude Sonnet 5 | 5/6 | Fail | Its provoked reply claimed to have watched the user queue specific kinds of tracks, though the prompt supplied no listening history. |

The explicit playback-risk case was classified as `question` by all three
models in both runs. No Slack or Spotify endpoint was called, so evaluation
could not post a message or change playback. In the initial run, all 18
structured responses parsed as JSON; all memory-set selections used four
allowed, distinct IDs. The evidence-supported answer cited the supplied item
for every model. Evidence-limit answers acknowledged the missing fact; the
Sonnet 4 empty-citation result is converted to the application's safe
limitation response.

The chart check is corroborated by
[Billboard's Gladys Knight & the Pips chart history](https://www.billboard.com/artist/gladys-knight-and-the-pips/chart-history/)
and [AllMusic's song history](https://www.allmusic.com/song/i-heard-it-through-the-grapevine-mt0001368705).
The release year for “What's Going On” is documented by
[Billboard](https://www.billboard.com/pro/marvin-gaye-whats-going-on-1971-rewinding-the-charts/).

## Initial live comparison

These are one nine-case batch per model. Token counts and reported costs came
from OpenRouter usage; estimated cost from catalog rates matched the reported
cost. The sample's p95 is effectively its slowest call, so it is descriptive,
not a stable tail-latency estimate.

| Model | Catalog rate, input/output per 1M tokens | Prompt / completion tokens | p50 / p95 latency | Failed / >15s / invalid JSON | Reported cost |
| --- | ---: | ---: | ---: | ---: | ---: |
| Claude Sonnet 4 | $3 / $15 | 3,090 / 1,006 | 935 ms / 2,900 ms | 0 / 0 / 0 | $0.02436 |
| Claude Sonnet 5 | $2 / $10 | 4,235 / 2,439 | 1,572 ms / 1,939 ms | 0 / 0 / 0 | $0.03286 |
| GPT-4.1 Mini | $0.40 / $1.60 | 2,796 / 710 | 725 ms / 1,639 ms | 0 / 0 / 0 | $0.002254 |

Sonnet 5's lower catalog rates did not lower its observed cost: it generated
more tokens and cost about 35% more than Sonnet 4 in this batch. GPT-4.1 Mini
was much cheaper and faster at the median, but the era error disqualifies it
under the hard factual gate.

## Post-change live evaluation

After adding the shared 15-second request helper and regression tests, the
same nine cases were run once more against all three live models. This is a
repeat check, not an independent quality study:

| Model | Prompt / completion tokens | p50 / p95 latency | Failed / >15s / invalid JSON | Reported cost |
| --- | ---: | ---: | ---: | ---: |
| Claude Sonnet 4 | 3,090 / 1,015 | 819 ms / 1,045 ms | 0 / 0 / 0 | $0.024495 |
| Claude Sonnet 5 | 4,235 / 2,759 | 1,703 ms / 1,980 ms | 0 / 0 / 0 | $0.03606 |
| GPT-4.1 Mini | 2,796 / 751 | 690 ms / 1,859 ms | 0 / 0 / 0 | $0.00232 |

All 27 calls completed, all 18 structured responses parsed, and the ambiguous
playback-risk message again classified as a question for every model. The
Sonnet 4 evidence-limit result again had no citation IDs and therefore remains
subject to the existing fail-closed limitation path. A separate live
Sonnet 4 request that included `response_format: {"type":"json_object"}`
returned HTTP 200 with valid JSON on its first attempt. The current catalog
does not advertise that parameter for Sonnet 4, so the shared helper still
retries without it only if OpenRouter explicitly rejects it.

## Implementation and limitations

- Fresh installs and `.env.example` use `anthropic/claude-sonnet-4`;
  `OPENROUTER_MODEL` overrides remain supported.
- All chat-completion paths, including memory-set generation, use the shared
  15-second deadline. Explicit JSON-mode rejection gets one retry without
  `response_format`; local parsing and the existing fail-closed checks remain
  in place.
- Background memory extraction remains separate on `OPENROUTER_EXTRACT_MODEL`.
- Automated verification: JamBot typecheck passed; all 25 test files and 229
  tests passed.
- Each run has only one sample per prompt and model. Outputs vary between
  runs, the blinded style scores are manual, and the factual examples do not
  establish general model reliability. A larger repeated benchmark is needed
  before changing the default.
- No production override was changed. No Slack message was posted and no
  playback action was performed.