import { canonicalSongLinkFromText, querySongShares, recentSongShares } from "./song-shares.js";

/** A narrow public-channel ledger question, not a general Slack transcript. */
export async function answerSongShareQuestion(
  text: string,
  resolveName: (slackUserId: string) => Promise<string>,
): Promise<string | null> {
  const specific = /\b(?:who shared|who posted|who said what about|what did .+ say about)\b/i.test(text);
  const isQuestion = specific || /\b(?:(?:which|what|any|recent) songs? (?:have been |were |did |are )?(?:shared|posted)|(?:show|list) (?:recent |the )?(?:shared|posted) (?:songs?|tracks?))\b/i.test(text);
  if (!isQuestion) return null;
  const link = canonicalSongLinkFromText(text);
  if (specific && !link) {
    return "Paste a supported song link and I can show who shared it and what they wrote. I can't safely identify a posted link from a title alone.";
  }
  // Names can collide. A speaker-specific question must name a verified
  // Slack identity; otherwise show no potentially misattributed quote.
  const namedSpeaker = /\bwhat did\s+(.+?)\s+say about\b/i.exec(text);
  const speakerId = namedSpeaker?.[1]?.match(/^<@([UW][A-Z0-9]+)>$/i)?.[1];
  if (namedSpeaker && !speakerId) {
    return "Mention the person in Slack and paste the song link so I can attribute their comment correctly.";
  }
  const rows = link
    ? querySongShares({ linkType: link.link_type, canonicalId: link.canonical_id,
      ...(speakerId ? { slackUserId: speakerId } : {}), limit: 5 })
    : recentSongShares(5);
  if (!rows.length) {
    return "I haven't recorded a matching song link from this channel in the last 90 days. For a specific song, paste its link; a title alone may not match a posted URL.";
  }
  const lines = await Promise.all(rows.map(async (row) => {
    const name = (await resolveName(row.slack_user_id)).replace(/[\r\n<>|*`]/g, " ").slice(0, 70);
    const when = new Date(Number(row.message_ts) * 1000);
    const time = Number.isFinite(when.getTime()) ? when.toISOString().slice(0, 16).replace("T", " ") + " UTC" : "time unknown";
    const context = row.context?.replace(/[<>|*`]/g, " ");
    return `• ${name} shared ${row.canonical_url}${context ? ` — said: “${context}”` : " (no accompanying comment)"} (${time})`;
  }));
  return `Song links shared in this Slack channel (newest first):\n${lines.join("\n")}\nThis tracks posts and speakers, not anyone's personal taste or Matt's library.`;
}