# Turntable capture helper

A tiny desktop helper for Jam Bot's **turntable sync**. It records short rolling
audio clips from a capture device (a USB turntable, a line-in, or a mic pointed
at your speakers) and POSTs them to the bot's `/turntable/identify` endpoint. The
bot fingerprints each clip with ACRCloud, works out which record is playing, and
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

Note the `[id]` of the input you want (turntable / line-in / mic). You can pass
either that number or a substring of the device name as `DEVICE`.

## Run

```bash
INGEST_URL=https://<your-bot-host>/turntable/identify \
INGEST_SECRET=<TURNTABLE_INGEST_SECRET> \
DEVICE="USB Audio" \
npm start
```

Then, in Slack: `/turntable start`, drop the needle, and the bot will follow the
record. `/turntable status` shows what it's tracking, `/turntable resync` nudges
the position back in line if it drifts, and `/turntable stop` ends the session.

## Configuration (environment variables)

| Variable           | Required | Default     | Notes                                                                 |
| ------------------ | -------- | ----------- | --------------------------------------------------------------------- |
| `INGEST_URL`       | yes      | —           | Full URL of the bot's `/turntable/identify` endpoint.                 |
| `INGEST_SECRET`    | yes      | —           | Must equal the bot's `TURNTABLE_INGEST_SECRET`.                       |
| `DEVICE`           | no       | system default | Device id number, or a case-insensitive substring of its name.    |
| `SAMPLE_RATE`      | no       | `44100`     | Capture sample rate (Hz).                                             |
| `CHANNELS`         | no       | `1`         | `1` (mono) is plenty for fingerprinting.                             |
| `SAMPLE_SECONDS`   | no       | `12`        | Length of each fingerprint clip. ~8–15s works well.                  |
| `INTERVAL_SECONDS` | no       | `20`        | How often a clip is sent. Keep ≥ `SAMPLE_SECONDS`.                   |

The bot only runs ACRCloud while a turntable session is active, so the helper
can keep streaming harmlessly between sets — clips sent while the session is off
get a cheap "idle" reply and never touch your ACRCloud quota.

## Notes

- Run the helper on the **same machine or LAN** as the record player; only the
  short clips leave your network, and only to your own bot.
- If matches are flaky, raise `SAMPLE_SECONDS` a little or move the mic closer /
  improve the line-in level. ACRCloud needs a reasonably clean signal.
