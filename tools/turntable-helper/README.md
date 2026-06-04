# Turntable capture helper

A tiny desktop helper for Jam Bot's **turntable sync**. It records short rolling
audio clips from either:

- a **physical capture device** — a USB turntable, a line-in, or a mic pointed
  at your speakers (the original "follow my record" mode), or
- the **computer's own audio** — whatever is playing on the host machine (a
  YouTube/Apple Music tab, DJ software, a local file), captured via the OS
  loopback/monitor (the new "follow my computer audio" mode).

It POSTs the clips to the bot's `/turntable/identify` endpoint. The bot
fingerprints each clip with ACRCloud, works out which track is playing, and
drives the host Spotify account to the matching track + position. Spotify Jam
then cascades that *streamed* version to every guest.

The captured audio is used **only** to identify the track. The bot never stores
it and never re-broadcasts it — guests always hear Spotify's own stream.

## Why this lives outside the workspace

This package depends on `naudiodon`, a **native** audio module that compiles
against your operating system. We deliberately keep it out of the pnpm workspace
so it never tries to build inside Replit (which has no audio hardware). Install
and run it on the machine next to your record player.

## Requirements

- Node.js 20+
- An audio input device the OS can see
- Build tooling for the native module:
  - **Linux:** `sudo apt-get install libasound2-dev` plus `build-essential`
  - **macOS:** Xcode command line tools (`xcode-select --install`)
  - **Windows:** the "Desktop development with C++" workload (Visual Studio Build Tools)

## Install

```bash
cd tools/turntable-helper
npm install
```

## Pick your input device

```bash
npm run devices
```

Note the `[id]` of the input you want. You can pass either that number or a
substring of the device name as `DEVICE`. Devices that carry whatever the
computer is playing (a PulseAudio "Monitor of …", Windows "Stereo Mix", macOS
BlackHole, etc.) are tagged `<loopback>` in the listing.

## Run — follow my record (physical input)

```bash
INGEST_URL=https://<your-bot-host>/turntable/identify \
INGEST_SECRET=<TURNTABLE_INGEST_SECRET> \
DEVICE="USB Audio" \
npm start
```

## Run — follow my computer audio (loopback)

To follow whatever is playing on the host machine instead of a physical input,
run in computer-audio mode. It auto-picks the OS loopback/monitor device, so you
don't need to find a `DEVICE` id by hand:

```bash
SOURCE=computer \
INGEST_URL=https://<your-bot-host>/turntable/identify \
INGEST_SECRET=<TURNTABLE_INGEST_SECRET> \
npm start
```

What "loopback" needs per OS (see [Capturing computer audio](#capturing-computer-audio-per-os)
below for details):

- **Linux** (PulseAudio/PipeWire): nothing — a "Monitor of <output>" source
  exists for free and is auto-selected.
- **Windows**: enable **Stereo Mix**, or install a virtual cable (VB-Audio /
  VoiceMeeter) and route your source app to it.
- **macOS**: no built-in loopback — install **BlackHole** (free) or **Loopback**
  and route your source into it.

If auto-detection can't find a loopback device, the helper prints an OS-specific
hint; you can always fall back to `DEVICE="<name or id>"` (an explicit `DEVICE`
overrides `SOURCE=computer`).

> **⚠ Don't capture the bot's own Spotify.** Spotify Jam already cascades the
> host's own Spotify to guests natively, so this mode exists to bridge
> **non-Spotify** sources. The bot drives your Spotify as a silent robot to feed
> the Jam — keep that Spotify **muted locally or on a different output** than the
> source you're capturing, or identification loops on itself. Muting locally
> does **not** stop guests hearing it (Jam cascades from Spotify's servers, not
> your local speakers). The same-track case (it re-confirms what's already
> playing) is harmless.

Then, in Slack: `/turntable start`, start your source, and the bot will follow
it. `/turntable status` shows what it's tracking, `/turntable resync` nudges the
position back in line if it drifts, and `/turntable stop` ends the session.

## Configuration (environment variables)

| Variable           | Required | Default     | Notes                                                                 |
| ------------------ | -------- | ----------- | --------------------------------------------------------------------- |
| `INGEST_URL`       | yes      | —           | Full URL of the bot's `/turntable/identify` endpoint.                 |
| `INGEST_SECRET`    | yes      | —           | Must equal the bot's `TURNTABLE_INGEST_SECRET`.                       |
| `SOURCE`           | no       | `device`    | `device` (physical input / default — vinyl, line-in, mic) or `computer` (aka `system`/`loopback`) to auto-pick the OS loopback/monitor. An explicit `DEVICE` always wins. |
| `DEVICE`           | no       | system default | Device id number, or a case-insensitive substring of its name.    |
| `SAMPLE_RATE`      | no       | `44100`     | Capture sample rate (Hz).                                             |
| `CHANNELS`         | no       | `1`         | `1` (mono) is plenty for fingerprinting.                             |
| `SAMPLE_SECONDS`   | no       | `12`        | Length of each fingerprint clip. ~8–15s works well.                  |
| `INTERVAL_SECONDS` | no       | `20`        | How often a clip is sent. Keep ≥ `SAMPLE_SECONDS`.                   |

The bot only runs ACRCloud while a turntable session is active, so the helper
can keep streaming harmlessly between sets — clips sent while the session is off
get a cheap "idle" reply and never touch your ACRCloud quota.

## Capturing computer audio (per-OS)

`SOURCE=computer` selects an OS **loopback / monitor input** — a device that
carries whatever the computer is playing — and feeds that to identification.
portaudio (the native module here) doesn't expose Windows' WASAPI loopback flag
as its own stream, so on every platform the helper works by picking a loopback
*input device* by name. What that requires:

- **Linux (PulseAudio / PipeWire)** — works out of the box. Every output sink
  has a matching `Monitor of <sink>` source; the helper auto-selects it. If it's
  missing from `npm run devices`, open `pavucontrol` → **Recording** and make
  sure the monitor source isn't hidden/muted.
- **Windows** — enable **Stereo Mix**: Sound settings → **Recording** →
  right-click → **Show Disabled Devices** → enable "Stereo Mix". If your sound
  card has no Stereo Mix, install a virtual cable (VB-Audio Cable, VoiceMeeter)
  and set it as your playback device (or route the source app to it); its
  "CABLE Output" then shows up as a `<loopback>` input.
- **macOS** — there's no built-in loopback. Install **BlackHole** (free) or
  **Loopback**. To still hear the audio yourself, create a **Multi-Output
  Device** (your speakers + BlackHole) in Audio MIDI Setup and play your source
  into it; the helper captures BlackHole.

Run `npm run devices` to confirm — loopback inputs are tagged `<loopback>`.

### Avoiding the feedback loop

In computer-audio mode the bot still drives **your** Spotify to feed the Jam.
If that Spotify plays into the same device you're capturing, the helper will
hear the bot's own output and identification loops on itself. Keep the bot's
Spotify on a **different output device** or **muted locally**. Muting locally
does **not** stop guests hearing it — Jam cascades from Spotify's servers based
on playback state, not your local speakers. (Capturing the host's own Spotify is
also pointless: Jam already cascades it natively.) The startup banner prints
this reminder whenever `SOURCE=computer`.

## Notes

- Run the helper on the **same machine or LAN** as the source; only the short
  clips leave your network, and only to your own bot.
- If matches are flaky, raise `SAMPLE_SECONDS` a little, move the mic closer /
  improve the line-in level, or (for loopback) make sure the monitor/loopback
  device isn't muted. ACRCloud needs a reasonably clean signal.
