// Jam Bot — turntable capture helper: pure device-selection logic.
// ---------------------------------------------------------------------------
// This module contains ONLY the source-selection logic (loopback/monitor
// detection, explicit-device precedence, computer-audio auto-pick). It takes a
// plain device list as input and imports NOTHING native — in particular it does
// NOT import `naudiodon`. That keeps it importable (and unit-testable) inside an
// environment with no audio hardware, while `index.mjs` supplies the real
// device list from portaudio at runtime.
//
// A "device" here is the shape naudiodon's `getDevices()` returns, of which we
// only use: { id: number, name: string, maxInputChannels: number }.

// Aliases that all mean "follow whatever the computer is playing".
export const COMPUTER_SOURCE_ALIASES = [
  "computer",
  "system",
  "loopback",
  "desktop",
];

// Heuristics for spotting an OS loopback / monitor INPUT device by name. These
// are the devices that carry "whatever the computer is playing":
//   - Linux / PulseAudio: a "Monitor of <sink>" source (always present, no
//     setup needed).
//   - Windows: "Stereo Mix" (must be enabled in Sound settings) or a virtual
//     cable (VB-Audio "CABLE Output", VoiceMeeter, Creative "What U Hear").
//   - macOS: a virtual loopback device must be installed (BlackHole, Loopback,
//     or the legacy Soundflower) — macOS has no built-in loopback.
// portaudio/naudiodon does not expose WASAPI's loopback flag as a separate
// stream, so across all three platforms we capture by selecting one of these
// loopback INPUT devices by name.
export const LOOPBACK_NAME_PATTERNS = [
  /monitor/i, // PulseAudio "Monitor of ..."
  /stereo mix/i, // Windows built-in (enable in Sound settings)
  /\bloopback\b/i, // generic / macOS "Loopback" by Rogue Amoeba
  /blackhole/i, // macOS BlackHole
  /soundflower/i, // macOS Soundflower (legacy)
  /voicemeeter/i, // Windows VoiceMeeter virtual outputs
  /cable output/i, // VB-Audio Virtual Cable (Windows)
  /wave ?out mix/i, // some Windows drivers
  /what ?u ?hear/i, // Creative "What U Hear"
];

export function isLoopbackName(name) {
  return LOOPBACK_NAME_PATTERNS.some((re) => re.test(name));
}

// Find the best loopback / monitor INPUT device for computer-audio mode, or
// null if none is present. Prefers a device whose name suggests the system's
// primary/default sink so we follow "what's actually playing".
export function findLoopbackDevice(devices) {
  const loopbacks = devices.filter(
    (d) => d.maxInputChannels > 0 && isLoopbackName(d.name),
  );
  if (loopbacks.length === 0) return null;
  return (
    loopbacks.find((d) => /default|stereo mix|blackhole/i.test(d.name)) ??
    loopbacks[0]
  );
}

// Sentinel returned to mean "use portaudio's default input device".
export const DEFAULT_INPUT_DEVICE_ID = -1;

// Resolve which device id to capture from, given the available `devices`, the
// requested `device` (a numeric id, a name substring, or "" for none), and
// whether computer-audio mode is active. Pure: no env reads, no native imports.
//
// Precedence (matches index.mjs):
//   1. An explicit DEVICE always wins, in any source mode.
//   2. Computer-audio mode auto-picks the OS loopback / monitor input.
//   3. Otherwise fall back to portaudio's default input.
//
// Throws a clear Error when an explicit DEVICE matches nothing, or when
// computer mode finds no loopback device.
export function resolveDeviceId({ devices, device = "", sourceIsComputer = false }) {
  // An explicit DEVICE always wins, in any source mode.
  if (device !== "") {
    if (/^\d+$/.test(device)) return Number(device);
    const wanted = device.toLowerCase();
    const match = devices.find(
      (d) => d.maxInputChannels > 0 && d.name.toLowerCase().includes(wanted),
    );
    if (!match) {
      throw new Error(
        `No input device matching "${device}". Run \`npm run devices\` to list them.`,
      );
    }
    return match.id;
  }

  // Computer-audio mode: auto-pick the OS loopback / monitor input.
  if (sourceIsComputer) {
    const dev = findLoopbackDevice(devices);
    if (!dev) {
      throw new Error(
        "SOURCE=computer but no loopback / monitor input device was found.",
      );
    }
    return dev.id;
  }

  return DEFAULT_INPUT_DEVICE_ID; // portaudio default input (original behavior)
}
