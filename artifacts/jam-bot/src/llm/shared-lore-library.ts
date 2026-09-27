import { config } from "../config.js";

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function safe(value: unknown, max = 100): string {
  return typeof value === "string"
    ? value.replace(/[\r\n\t<>|&*`]/g, " ").trim().slice(0, max)
    : "";
}

function observed(value: unknown): string | null {
  if (typeof value !== "string" || !Number.isFinite(Date.parse(value))) return null;
  return new Date(value).toISOString().slice(0, 16).replace("T", " ") + " UTC";
}

async function internalRequest(
  path: string,
  options: { method?: "GET" | "POST"; body?: unknown },
): Promise<{ status: number; payload: unknown }> {
  if (!config.SESSION_SECRET) return { status: 503, payload: null };
  try {
    const response = await fetch(`${config.LORE_API_BASE.replace(/\/+$/, "")}${path}`, {
      method: options.method ?? "GET",
      headers: {
        "x-lore-internal-secret": config.SESSION_SECRET,
        ...(options.body ? { "Content-Type": "application/json" } : {}),
      },
      ...(options.body ? { body: JSON.stringify(options.body) } : {}),
      redirect: "error",
      signal: AbortSignal.timeout(8_000),
    });
    return { status: response.status, payload: await response.json() as unknown };
  } catch {
    return { status: 503, payload: null };
  }
}

/** Only the verified host DM can call this. Never post the returned URL in-channel. */
export async function createLibraryHandoff(workspaceId: string): Promise<string> {
  if (!config.JAM_QUIET_DM_USER || !config.SESSION_SECRET || !workspaceId) {
    return "Lore library linking isn't configured. The operator needs to set the host Slack ID and shared Lore service secret.";
  }
  if (!config.LORE_PUBLIC_URL) {
    return "Lore library linking needs LORE_PUBLIC_URL set to the browser-visible Lore address.";
  }
  let base: URL;
  try {
    base = new URL(config.LORE_PUBLIC_URL);
    if (base.protocol !== "https:" || base.username || base.password || base.search || base.hash) {
      throw new Error("Invalid public URL");
    }
  } catch {
    return "LORE_PUBLIC_URL must be a public HTTPS Lore address before linking a library.";
  }
  const result = await internalRequest("/me/jambot-sharing/internal/handoffs", {
    method: "POST",
    body: {
      workspaceId,
      channelId: config.SLACK_CHANNEL_ID,
      slackUserId: config.JAM_QUIET_DM_USER,
      ownerLabel: "Matt",
    },
  });
  if (result.status !== 201 || !record(result.payload) ||
      typeof result.payload.handoffToken !== "string" ||
      !/^[A-Za-z0-9_-]{32,120}$/.test(result.payload.handoffToken)) {
    return "I couldn't create a private Lore pairing link. Check that Lore sharing is enabled, then try again.";
  }
  base.pathname = `${base.pathname.replace(/\/+$/, "")}/shared-library`;
  base.hash = result.payload.handoffToken;
  return `Open this one-time link in the browser session that holds your loaded Lore library, review the channel scope, then confirm. It expires in 10 minutes:\n<${base.toString()}|Connect Matt's Lore library>\nYou can revoke it from that Lore page any time.`;
}

export async function answerSharedLibraryCrossings(workspaceId: string): Promise<string> {
  if (!config.JAM_QUIET_DM_USER || !config.SESSION_SECRET || !workspaceId) {
    return "Matt's shared Lore library isn't configured. I can't use a random Lore device session as a substitute.";
  }
  const params = new URLSearchParams({
    workspaceId,
    channelId: config.SLACK_CHANNEL_ID,
    slackUserId: config.JAM_QUIET_DM_USER,
  });
  const result = await internalRequest(`/me/jambot-sharing/internal/crossings?${params}`, {});
  if (result.status === 404) {
    return "Matt's Lore library isn't linked to this Slack channel yet. Matt can DM me “link my Lore library” to connect it privately.";
  }
  if (result.status !== 200 || !record(result.payload)) {
    return "I couldn't securely check Matt's shared Lore library right now. Please try again.";
  }
  const data = result.payload;
  if (data.state === "computing") {
    return "Lore is still checking current radio crossings with Matt's library; I won't call that no matches. Please ask again shortly.";
  }
  if (data.state === "failed" || data.state !== "settled" || !Array.isArray(data.items)) {
    return "Lore couldn't finish checking current crossings with Matt's library. Please try again shortly.";
  }
  const rows = data.items.filter(record).flatMap((row) => {
    const station = safe(row.station);
    const artist = safe(row.artist);
    const title = safe(row.title);
    const when = observed(row.observedAt);
    const kind = row.matchKind;
    if (!station || !artist || !title || !when ||
        (kind !== "recording" && kind !== "album" && kind !== "artist")) return [];
    const reason = kind === "recording" ? "exact recording in Matt's library"
      : kind === "album" ? "album represented in Matt's library"
      : "artist represented in Matt's library (not necessarily this song)";
    return [`• ${station}: ${artist} — ${title} (${reason}; observed ${when})`];
  }).slice(0, 5);
  if (!rows.length) {
    return "I can't confirm a current overlap with Matt's library from Lore's fresh station observations right now. This is not a claim about stations without fresh metadata. Source: Lore live radio + Matt's approved shared library.";
  }
  return `Current radio crossings with Matt's library:\n${rows.join("\n")}\nSource: Lore's fresh station observations + Matt's approved shared library. Artist-only matches do not mean the song is saved.`;
}