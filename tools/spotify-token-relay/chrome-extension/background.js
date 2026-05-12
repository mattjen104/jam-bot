const TARGET_HOST_PATTERNS = [
  "https://api.spotify.com/*",
  "https://api-partner.spotify.com/*",
  "https://*.spclient.spotify.com/*",
];

let lastPushedToken = null;
let lastPushAt = 0;

async function getSettings() {
  return new Promise((resolve) => {
    chrome.storage.local.get(["relayUrl", "relaySecret"], (s) => {
      resolve({
        relayUrl: (s.relayUrl || "").trim().replace(/\/+$/, ""),
        relaySecret: (s.relaySecret || "").trim(),
      });
    });
  });
}

async function setStatus(status, detail) {
  chrome.storage.local.set({
    lastStatus: status,
    lastStatusDetail: detail || "",
    lastStatusAt: Date.now(),
  });
}

async function pushTokenToRelay(token) {
  const { relayUrl, relaySecret } = await getSettings();
  if (!relayUrl || !relaySecret) {
    await setStatus(
      "unconfigured",
      "Set relay URL and secret in the extension options.",
    );
    return;
  }

  const now = Date.now();
  if (token === lastPushedToken) {
    return;
  }

  try {
    const res = await fetch(`${relayUrl}/admin/set-token`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${relaySecret}`,
      },
      body: JSON.stringify({
        accessToken: token,
      }),
    });
    if (!res.ok) {
      const body = await res.text();
      await setStatus(
        "error",
        `Relay returned ${res.status}: ${body.slice(0, 200)}`,
      );
      console.warn("[jam-relay] push failed", res.status, body);
      return;
    }
    lastPushedToken = token;
    lastPushAt = now;
    await setStatus("ok", `Pushed token at ${new Date(now).toLocaleTimeString()}`);
    console.log("[jam-relay] token pushed to", relayUrl);
  } catch (err) {
    await setStatus("error", String(err));
    console.warn("[jam-relay] push exception", err);
  }
}

chrome.webRequest.onSendHeaders.addListener(
  (details) => {
    const auth = details.requestHeaders?.find(
      (h) => h.name.toLowerCase() === "authorization",
    );
    if (!auth || !auth.value) return;
    const m = auth.value.match(/^Bearer\s+([A-Za-z0-9_\-\.~\+\/=]+)$/);
    if (!m) return;
    const token = m[1];
    if (token.length < 40) return;
    pushTokenToRelay(token);
  },
  { urls: TARGET_HOST_PATTERNS },
  ["requestHeaders"],
);

// No heartbeat: re-pushing the same token would not refresh Spotify's
// real expiry. We only push when a NEW token value is observed in
// outbound Spotify API traffic, which is the actual signal that
// Spotify's web player has rotated its token. The relay enforces a
// hard lifetime cap on each unique token regardless.
