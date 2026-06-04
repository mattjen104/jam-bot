// Unit tests for the pure device-selection logic. Run with Node's built-in test
// runner (no extra deps, no native audio module):
//
//   cd tools/turntable-helper
//   npm test
//
// The helper lives outside the pnpm workspace because of its native `naudiodon`
// dependency, so we keep these tests self-contained on node:test/node:assert.

import { test } from "node:test";
import assert from "node:assert/strict";

import { Buffer } from "node:buffer";

import {
  BYTES_PER_SAMPLE,
  DEFAULT_INPUT_DEVICE_ID,
  capturingLoopback,
  findLoopbackDevice,
  isLoopbackName,
  resolveDeviceId,
  wavFromPcm,
} from "./device-detection.mjs";

// A small fixture mimicking naudiodon's getDevices() shape.
const dev = (id, name, maxInputChannels = 2) => ({
  id,
  name,
  maxInputChannels,
});

test("explicit DEVICE (by id) wins over SOURCE=computer", () => {
  const devices = [
    dev(0, "Built-in Microphone"),
    dev(1, "Monitor of Built-in Audio"),
    dev(2, "USB Audio CODEC"),
  ];
  const id = resolveDeviceId({
    devices,
    device: "2",
    sourceIsComputer: true,
  });
  assert.equal(id, 2);
});

test("explicit DEVICE (by name substring) wins over SOURCE=computer", () => {
  const devices = [
    dev(0, "Built-in Microphone"),
    dev(1, "Monitor of Built-in Audio"),
    dev(7, "USB Audio CODEC"),
  ];
  const id = resolveDeviceId({
    devices,
    device: "usb audio",
    sourceIsComputer: true,
  });
  assert.equal(id, 7);
});

test("explicit DEVICE that matches nothing throws a clear error", () => {
  const devices = [dev(0, "Built-in Microphone")];
  assert.throws(
    () => resolveDeviceId({ devices, device: "nonexistent" }),
    /No input device matching "nonexistent"/,
  );
});

test("explicit DEVICE ignores output-only devices when matching by name", () => {
  const devices = [
    dev(0, "Speakers (USB Audio)", 0), // output only — should not match
    dev(1, "Line In (USB Audio)", 2),
  ];
  const id = resolveDeviceId({ devices, device: "usb audio" });
  assert.equal(id, 1);
});

test("computer mode picks a loopback when one is present", () => {
  const devices = [
    dev(0, "Built-in Microphone"),
    dev(1, "Monitor of Built-in Audio Analog Stereo"),
  ];
  const id = resolveDeviceId({ devices, sourceIsComputer: true });
  assert.equal(id, 1);
});

test("computer mode prefers a default/stereo-mix/blackhole loopback", () => {
  const devices = [
    dev(0, "Monitor of HDMI Output"),
    dev(1, "Monitor of Built-in Audio (default)"),
  ];
  const id = resolveDeviceId({ devices, sourceIsComputer: true });
  assert.equal(id, 1, "should prefer the device whose name marks the default sink");
});

test("computer mode errors clearly when no loopback is present", () => {
  const devices = [
    dev(0, "Built-in Microphone"),
    dev(1, "USB Audio CODEC"),
  ];
  assert.throws(
    () => resolveDeviceId({ devices, sourceIsComputer: true }),
    /no loopback \/ monitor input device was found/,
  );
});

test("computer mode ignores loopback names that are output-only", () => {
  const devices = [
    dev(0, "Stereo Mix", 0), // shows up as an output with no input channels
  ];
  assert.throws(
    () => resolveDeviceId({ devices, sourceIsComputer: true }),
    /no loopback \/ monitor input device was found/,
  );
});

test("default (device) mode returns the default input sentinel", () => {
  const devices = [
    dev(0, "Built-in Microphone"),
    dev(1, "Monitor of Built-in Audio"),
  ];
  const id = resolveDeviceId({ devices });
  assert.equal(id, DEFAULT_INPUT_DEVICE_ID);
  assert.equal(id, -1);
});

test("findLoopbackDevice returns null when nothing matches", () => {
  const devices = [dev(0, "Built-in Microphone"), dev(1, "USB Audio CODEC")];
  assert.equal(findLoopbackDevice(devices), null);
});

test("loopback name patterns match representative device names per OS", () => {
  const loopbackNames = [
    "Monitor of Built-in Audio Analog Stereo", // Linux / PulseAudio
    "Stereo Mix (Realtek High Definition Audio)", // Windows built-in
    "BlackHole 2ch", // macOS BlackHole
    "Soundflower (2ch)", // macOS Soundflower (legacy)
    "Loopback Audio", // Rogue Amoeba Loopback (macOS)
    "VoiceMeeter Output (VB-Audio VoiceMeeter VAIO)", // Windows VoiceMeeter
    "CABLE Output (VB-Audio Virtual Cable)", // VB-Audio Virtual Cable
    "Wave Out Mix", // some Windows drivers
    "What U Hear (Creative)", // Creative "What U Hear"
  ];
  for (const name of loopbackNames) {
    assert.ok(isLoopbackName(name), `expected loopback: "${name}"`);
  }
});

test("ordinary input device names are not treated as loopbacks", () => {
  const nonLoopbackNames = [
    "Built-in Microphone",
    "USB Audio CODEC",
    "Scarlett 2i2 USB",
    "MacBook Pro Microphone",
    "Headset Microphone (Realtek)",
  ];
  for (const name of nonLoopbackNames) {
    assert.ok(!isLoopbackName(name), `did not expect loopback: "${name}"`);
  }
});

// --- wavFromPcm: 44-byte RIFF/WAVE header correctness ----------------------

// Read the header fields back out so the test fails loudly if any offset,
// endianness, or derived value (byteRate, blockAlign) is wrong.
const readWavHeader = (buf) => ({
  riff: buf.toString("ascii", 0, 4),
  riffSize: buf.readUInt32LE(4),
  wave: buf.toString("ascii", 8, 12),
  fmt: buf.toString("ascii", 12, 16),
  fmtChunkSize: buf.readUInt32LE(16),
  audioFormat: buf.readUInt16LE(20),
  channels: buf.readUInt16LE(22),
  sampleRate: buf.readUInt32LE(24),
  byteRate: buf.readUInt32LE(28),
  blockAlign: buf.readUInt16LE(32),
  bitsPerSample: buf.readUInt16LE(34),
  data: buf.toString("ascii", 36, 40),
  dataSize: buf.readUInt32LE(40),
});

test("wavFromPcm writes a 44-byte header and appends the PCM payload", () => {
  const pcm = Buffer.alloc(160);
  const wav = wavFromPcm(pcm, { sampleRate: 44100, channels: 1 });
  assert.equal(wav.length, 44 + pcm.length);
  // The data after the header is exactly the PCM bytes we passed in.
  assert.ok(wav.subarray(44).equals(pcm));
});

test("wavFromPcm header is correct for mono @ 44100Hz", () => {
  const pcm = Buffer.alloc(1000);
  const h = readWavHeader(wavFromPcm(pcm, { sampleRate: 44100, channels: 1 }));
  assert.equal(h.riff, "RIFF");
  assert.equal(h.wave, "WAVE");
  assert.equal(h.fmt, "fmt ");
  assert.equal(h.data, "data");
  assert.equal(h.fmtChunkSize, 16);
  assert.equal(h.audioFormat, 1, "PCM");
  assert.equal(h.channels, 1);
  assert.equal(h.sampleRate, 44100);
  assert.equal(h.bitsPerSample, BYTES_PER_SAMPLE * 8);
  assert.equal(h.bitsPerSample, 16);
  assert.equal(h.blockAlign, 1 * BYTES_PER_SAMPLE); // 2
  assert.equal(h.byteRate, 44100 * 1 * BYTES_PER_SAMPLE); // 88200
  assert.equal(h.dataSize, pcm.length);
  assert.equal(h.riffSize, 36 + pcm.length);
});

test("wavFromPcm header is correct for stereo @ 48000Hz", () => {
  const pcm = Buffer.alloc(2048);
  const h = readWavHeader(wavFromPcm(pcm, { sampleRate: 48000, channels: 2 }));
  assert.equal(h.channels, 2);
  assert.equal(h.sampleRate, 48000);
  assert.equal(h.blockAlign, 2 * BYTES_PER_SAMPLE); // 4
  assert.equal(h.byteRate, 48000 * 2 * BYTES_PER_SAMPLE); // 384000
  assert.equal(h.bitsPerSample, 16);
  assert.equal(h.dataSize, pcm.length);
  assert.equal(h.riffSize, 36 + pcm.length);
});

test("wavFromPcm header is correct for stereo @ 22050Hz", () => {
  const pcm = Buffer.alloc(64);
  const h = readWavHeader(wavFromPcm(pcm, { sampleRate: 22050, channels: 2 }));
  assert.equal(h.channels, 2);
  assert.equal(h.sampleRate, 22050);
  assert.equal(h.blockAlign, 4);
  assert.equal(h.byteRate, 22050 * 2 * BYTES_PER_SAMPLE); // 88200
  assert.equal(h.dataSize, 64);
  assert.equal(h.riffSize, 36 + 64);
});

test("wavFromPcm handles an empty PCM payload", () => {
  const h = readWavHeader(wavFromPcm(Buffer.alloc(0), { sampleRate: 44100, channels: 1 }));
  assert.equal(h.dataSize, 0);
  assert.equal(h.riffSize, 36);
});

// --- capturingLoopback: feedback-loop warning decision ---------------------

test("capturingLoopback warns for an auto-picked loopback (computer, no DEVICE)", () => {
  assert.equal(
    capturingLoopback({
      sourceIsComputer: true,
      device: "",
      selectedDeviceName: "Monitor of Built-in Audio Analog Stereo",
    }),
    true,
  );
});

test("capturingLoopback warns for an explicit DEVICE that looks like a loopback", () => {
  assert.equal(
    capturingLoopback({
      sourceIsComputer: false,
      device: "blackhole",
      selectedDeviceName: "BlackHole 2ch",
    }),
    true,
  );
});

test("capturingLoopback does NOT warn when computer is overridden by a physical DEVICE", () => {
  assert.equal(
    capturingLoopback({
      sourceIsComputer: true,
      device: "usb audio",
      selectedDeviceName: "USB Audio CODEC",
    }),
    false,
  );
});

test("capturingLoopback does NOT warn for the system default input (no name)", () => {
  assert.equal(
    capturingLoopback({
      sourceIsComputer: false,
      device: "",
      selectedDeviceName: null,
    }),
    false,
  );
});

test("capturingLoopback does NOT warn for an ordinary explicit DEVICE", () => {
  assert.equal(
    capturingLoopback({
      sourceIsComputer: false,
      device: "scarlett",
      selectedDeviceName: "Scarlett 2i2 USB",
    }),
    false,
  );
});
