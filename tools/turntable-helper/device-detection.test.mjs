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

import {
  DEFAULT_INPUT_DEVICE_ID,
  findLoopbackDevice,
  isLoopbackName,
  resolveDeviceId,
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
