// Jam Bot — turntable capture helper (desktop / host machine)
// ---------------------------------------------------------------------------
// Records short rolling audio clips from a capture device (a USB turntable,
// a line-in, a mic pointed at your speakers, or the computer's own loopback /
// monitor of whatever it's currently playing) and POSTs the raw WAV bytes to
// the bot's /turntable/identify endpoint. The bot fingerprints each clip with
// ACRCloud, figures out which record is on, and drives the host Spotify account
// to the matching track + offset so the Jam cascades the *streamed* version to
// everyone. The captured audio is used only for identification — the bot never
// stores or re-broadcasts it.
//
// Run this on the SAME machine (or LAN) as the record player. It is NOT part of
// the pnpm workspace on purpose: it depends on a native audio module
// (naudiodon) that must compile against your OS, which we never want running
// inside the Replit install. Install + run it locally:
//
//   cd tools/turntable-helper
//   npm install
//   npm run devices          # find your input device id
//   INGEST_URL=https://<bot-host>/turntable/identify \
//   INGEST_SECRET=<TURNTABLE_INGEST_SECRET> \
//   DEVICE="USB Audio" \
//   npm start
//
// Then in Slack: `/turntable start`, drop the needle, and enjoy.
//
// To follow whatever is playing ON THE COMPUTER instead of a physical input
// (a YouTube/Apple Music tab, DJ software, a local file), run in computer-audio
// mode — it auto-picks the OS loopback/monitor device, so no DEVICE id needed:
//
//   SOURCE=computer \
//   INGEST_URL=https://<bot-host>/turntable/identify \
//   INGEST_SECRET=<TURNTABLE_INGEST_SECRET> \
//   npm start
//
// IMPORTANT: the captured source must NOT be the host's own Spotify — Spotify
// Jam already cascades that natively, so capturing it would just loop (listen
// to Spotify -> identify -> tell Spotify to play what it's already playing).
// Keep the bot's Spotify muted locally, or routed to a different output than
// the one being captured. Muting locally does NOT stop guests hearing it: Jam
// cascades from Spotify's servers based on playback state, not local speakers.

import { Buffer } from "node:buffer";
import {
  COMPUTER_SOURCE_ALIASES,
  DEFAULT_INPUT_DEVICE_ID,
  findLoopbackDevice,
  isLoopbackName,
  resolveDeviceId as resolveDeviceIdPure,
} from "./device-detection.mjs";

const LIST_DEVICES = process.argv.includes("--list-devices");

// ---- Config (all via env, with sane defaults) -----------------------------
const INGEST_URL = process.env.INGEST_URL ?? "";
const INGEST_SECRET = process.env.INGEST_SECRET ?? "";
// DEVICE may be a numeric portaudio device id OR a case-insensitive substring
// of the device name. Empty -> the system default input device.
const DEVICE = process.env.DEVICE ?? "";
// SOURCE selects WHERE audio comes from:
//   "device" (default) — the explicit DEVICE, or the system default input
//     (vinyl, line-in, mic). Unchanged from the original behavior.
//   "computer" (aka "system" / "loopback" / "desktop") — auto-pick the OS
//     loopback / monitor INPUT so the helper follows whatever the computer is
//     playing, without hunting for a device id. An explicit DEVICE still wins.
const SOURCE = (process.env.SOURCE ?? "device").toLowerCase();
const SOURCE_IS_COMPUTER = COMPUTER_SOURCE_ALIASES.includes(SOURCE);
if (SOURCE !== "device" && !SOURCE_IS_COMPUTER) {
  console.warn(
    `Unknown SOURCE="${SOURCE}" — falling back to "device" (physical input). ` +
      `Use "computer" to follow OS loopback audio.`,
  );
}
const SAMPLE_RATE = Number(process.env.SAMPLE_RATE ?? 44100);
const CHANNELS = Number(process.env.CHANNELS ?? 1);
// How many seconds of audio each fingerprint clip should contain. ACRCloud
// works well from ~8-15s; longer clips cost more bandwidth for no gain.
const SAMPLE_SECONDS = Number(process.env.SAMPLE_SECONDS ?? 12);
// How often to send a clip. Keep this comfortably >= SAMPLE_SECONDS so clips
// don't overlap heavily. The bot debounces, so over-sending is harmless aside
// from ACRCloud quota.
const INTERVAL_SECONDS = Number(process.env.INTERVAL_SECONDS ?? 20);
const BYTES_PER_SAMPLE = 2; // 16-bit PCM

function loadPortAudio() {
  // Imported lazily so `--list-devices` failures give a clear install hint
  // instead of a cryptic native-module stack trace at the top of the file.
  return import("naudiodon").catch((err) => {
    console.error(
      "Failed to load naudiodon. Install it first:\n" +
        "  cd tools/turntable-helper && npm install\n" +
        "If the build fails you may need OS audio dev headers " +
        "(e.g. `sudo apt-get install libasound2-dev` on Linux, or Xcode " +
        "command line tools on macOS).\n",
    );
    throw err;
  });
}

// The loopback/monitor name heuristics and device-selection logic live in
// ./device-detection.mjs so they can be unit-tested without the native audio
// module. See that file for the per-OS patterns (PulseAudio "Monitor of …",
// Windows "Stereo Mix", macOS BlackHole, virtual cables, etc.).

function loopbackSetupHint() {
  if (process.platform === "win32") {
    return (
      "  Windows: enable \"Stereo Mix\" (Sound settings -> Recording -> right-\n" +
      "  click -> Show Disabled Devices -> enable), or install a virtual cable\n" +
      "  such as VB-Audio Cable / VoiceMeeter and route your source app to it.\n"
    );
  }
  if (process.platform === "darwin") {
    return (
      "  macOS has no built-in loopback. Install BlackHole (free) or Loopback,\n" +
      "  then play your source into a Multi-Output / aggregate device so the\n" +
      "  loopback device hears it.\n"
    );
  }
  return (
    "  Linux (PulseAudio/PipeWire): a \"Monitor of <your output>\" source\n" +
    "  exists for free — it should appear in `npm run devices`. If it's hidden,\n" +
    "  unmute/enable the monitor source in pavucontrol's Recording tab.\n"
  );
}

function listDevices(portAudio) {
  const devices = portAudio.getDevices();
  console.log("Available audio devices (inputs have maxInputChannels > 0):\n");
  for (const d of devices) {
    const io = [];
    if (d.maxInputChannels > 0) io.push(`in:${d.maxInputChannels}`);
    if (d.maxOutputChannels > 0) io.push(`out:${d.maxOutputChannels}`);
    const loopTag =
      d.maxInputChannels > 0 && isLoopbackName(d.name) ? "  <loopback>" : "";
    console.log(
      `  [${d.id}] ${d.name}  (${io.join(" ")})  @${Math.round(
        d.defaultSampleRate,
      )}Hz${loopTag}`,
    );
  }
  console.log(
    '\nPick an input device and pass it as DEVICE (its id number, or a ' +
      'substring of its name, e.g. DEVICE="USB Audio").\n' +
      "Devices tagged <loopback> carry whatever the computer is playing — run " +
      "with\nSOURCE=computer to auto-pick one (no DEVICE needed).",
  );
}

function resolveDeviceId(portAudio) {
  const devices = portAudio.getDevices();

  // Computer-audio mode (no explicit DEVICE) is handled here rather than via the
  // pure resolver so we can attach an OS-specific setup hint to the "no loopback
  // found" error and log which loopback we auto-picked.
  if (DEVICE === "" && SOURCE_IS_COMPUTER) {
    const dev = findLoopbackDevice(devices);
    if (!dev) {
      throw new Error(
        "SOURCE=computer but no loopback / monitor input device was found.\n" +
          loopbackSetupHint() +
          'Then re-run, or list devices (`npm run devices`) and pass the right\n' +
          'one explicitly with DEVICE="<name or id>".',
      );
    }
    console.log(
      `Computer-audio mode: capturing loopback device [${dev.id}] ${dev.name}`,
    );
    return dev.id;
  }

  // Explicit DEVICE precedence and the default-input fallback are pure logic.
  return resolveDeviceIdPure({
    devices,
    device: DEVICE,
    sourceIsComputer: SOURCE_IS_COMPUTER,
  });
}

// Build a minimal 16-bit PCM WAV file from raw little-endian PCM samples.
function wavFromPcm(pcm, { sampleRate, channels }) {
  const blockAlign = channels * BYTES_PER_SAMPLE;
  const byteRate = sampleRate * blockAlign;
  const header = Buffer.alloc(44);
  header.write("RIFF", 0);
  header.writeUInt32LE(36 + pcm.length, 4);
  header.write("WAVE", 8);
  header.write("fmt ", 12);
  header.writeUInt32LE(16, 16); // PCM fmt chunk size
  header.writeUInt16LE(1, 20); // audio format = PCM
  header.writeUInt16LE(channels, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(byteRate, 28);
  header.writeUInt16LE(blockAlign, 32);
  header.writeUInt16LE(BYTES_PER_SAMPLE * 8, 34); // bits per sample
  header.write("data", 36);
  header.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([header, pcm]);
}

async function postClip(wav, clipDurationMs) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15_000);
  try {
    const res = await fetch(INGEST_URL, {
      method: "POST",
      headers: {
        "content-type": "audio/wav",
        "x-turntable-secret": INGEST_SECRET,
        // Lets the bot compensate for the clip window when seeking, since
        // ACRCloud's matched offset points at the START of this clip.
        "x-clip-duration-ms": String(Math.round(clipDurationMs)),
      },
      body: wav,
      signal: controller.signal,
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      console.warn(`  ingest ${res.status}: ${JSON.stringify(body)}`);
      return;
    }
    if (body.accepted === false) {
      console.log(`  idle (${body.reason ?? "not active"})`);
    } else if (body.matched) {
      console.log(
        `  matched: ${body.track?.title} — ${body.track?.artist} [${body.decision}]`,
      );
    } else {
      console.log(`  no match [${body.decision ?? "?"}]`);
    }
  } catch (err) {
    console.warn(`  ingest failed: ${err?.message ?? err}`);
  } finally {
    clearTimeout(timeout);
  }
}

async function main() {
  const portAudio = (await loadPortAudio()).default ?? (await loadPortAudio());

  if (LIST_DEVICES) {
    listDevices(portAudio);
    return;
  }

  if (!INGEST_URL || !INGEST_SECRET) {
    console.error(
      "INGEST_URL and INGEST_SECRET are required. Example:\n" +
        "  INGEST_URL=https://<bot-host>/turntable/identify \\\n" +
        "  INGEST_SECRET=<TURNTABLE_INGEST_SECRET> \\\n" +
        '  DEVICE="USB Audio" npm start',
    );
    process.exitCode = 1;
    return;
  }

  const deviceId = resolveDeviceId(portAudio);
  const clipBytes = SAMPLE_RATE * CHANNELS * BYTES_PER_SAMPLE * SAMPLE_SECONDS;

  console.log(
    `Capturing from device ${
      deviceId === DEFAULT_INPUT_DEVICE_ID ? "(default)" : deviceId
    } ` +
      `@ ${SAMPLE_RATE}Hz x${CHANNELS}, ${SAMPLE_SECONDS}s clips every ` +
      `${INTERVAL_SECONDS}s -> ${INGEST_URL}`,
  );

  // Warn about the feedback loop only when we're actually following computer
  // audio: an auto-picked loopback (SOURCE=computer, no DEVICE) or an explicit
  // device that itself looks like a loopback/monitor. Don't warn when the user
  // overrode SOURCE=computer with a physical DEVICE — the loop can't happen.
  const selected =
    deviceId === DEFAULT_INPUT_DEVICE_ID
      ? null
      : portAudio.getDevices().find((d) => d.id === deviceId);
  const capturingLoopback =
    (SOURCE_IS_COMPUTER && DEVICE === "") ||
    (selected ? isLoopbackName(selected.name) : false);

  if (capturingLoopback) {
    console.warn(
      "\nWARNING: computer-audio mode captures whatever this machine plays.\n" +
        "  The bot also drives YOUR Spotify to feed the Jam. Keep that Spotify\n" +
        "  on a DIFFERENT output device, or muted locally, than the source\n" +
        "  you're capturing — otherwise the helper hears the bot's own Spotify\n" +
        "  and identification loops on itself. Muting locally does NOT stop\n" +
        "  guests hearing it (Jam cascades from Spotify's servers). The\n" +
        "  same-track case (it re-confirms what's already playing) is harmless.\n",
    );
  }

  const ai = new portAudio.AudioIO({
    inOptions: {
      channelCount: CHANNELS,
      sampleFormat: portAudio.SampleFormat16Bit,
      sampleRate: SAMPLE_RATE,
      deviceId,
      closeOnError: false,
    },
  });

  // Rolling ring of the most recent PCM, capped at one clip's worth.
  let ring = [];
  let ringBytes = 0;
  ai.on("data", (chunk) => {
    ring.push(chunk);
    ringBytes += chunk.length;
    while (ringBytes > clipBytes && ring.length > 1) {
      ringBytes -= ring.shift().length;
    }
  });
  ai.on("error", (err) => console.warn(`audio error: ${err?.message ?? err}`));

  ai.start();

  let sending = false;
  const tick = async () => {
    if (sending) return; // never overlap network sends
    if (ringBytes < clipBytes * 0.5) return; // not enough buffered yet
    sending = true;
    const pcm = Buffer.concat(ring);
    const clipDurationMs =
      (pcm.length / (SAMPLE_RATE * CHANNELS * BYTES_PER_SAMPLE)) * 1000;
    try {
      await postClip(
        wavFromPcm(pcm, { sampleRate: SAMPLE_RATE, channels: CHANNELS }),
        clipDurationMs,
      );
    } finally {
      sending = false;
    }
  };
  const timer = setInterval(tick, INTERVAL_SECONDS * 1000);

  const shutdown = () => {
    clearInterval(timer);
    try {
      ai.quit();
    } catch {
      /* already closed */
    }
    console.log("\nStopped.");
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
