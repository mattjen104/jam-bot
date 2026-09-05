#!/usr/bin/env python3
"""Local-only Lore speech adapter backed by faster-whisper and Silero VAD."""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path


COMPONENTS = {"classifier", "vad", "stt"}


def emit(value: object) -> None:
    json.dump(value, sys.stdout, separators=(",", ":"))


def main() -> int:
    parser = argparse.ArgumentParser(add_help=False)
    parser.add_argument("component", choices=sorted(COMPONENTS))
    parser.add_argument("--self-test", action="store_true")
    parser.add_argument("--output-format")
    parser.add_argument("--model")
    parser.add_argument("--clip-timestamps")
    parser.add_argument("clip", nargs="?")
    args = parser.parse_intermixed_args()

    if args.self_test:
        emit(
            {
                "contract": "lore-speech-local.v1",
                "component": args.component,
                "outputFormat": "json",
                "localOnly": True,
            }
        )
        return 0

    if args.output_format != "json" or not args.model or not args.clip:
        parser.error("--output-format json, --model, and an input clip are required")

    config = json.loads(Path(args.model).read_text(encoding="utf-8"))
    from faster_whisper import WhisperModel

    model = WhisperModel(
        config["model"],
        device=config.get("device", "cpu"),
        compute_type=config.get("computeType", "int8"),
        cpu_threads=2,
        num_workers=1,
    )
    transcribe_options: dict[str, object] = {
        "language": "en",
        "beam_size": 1,
        "best_of": 1,
        "condition_on_previous_text": False,
        "vad_filter": True,
        "vad_parameters": {
            "min_speech_duration_ms": 180,
            "min_silence_duration_ms": 250,
            "speech_pad_ms": 120,
        },
    }
    if args.clip_timestamps:
        transcribe_options["clip_timestamps"] = args.clip_timestamps

    generated, _ = model.transcribe(args.clip, **transcribe_options)
    segments = [
        {"start": row.start, "end": row.end, "text": row.text.strip()}
        for row in generated
        if row.end >= row.start and row.text.strip()
    ]

    if args.component == "stt":
        emit({"segments": segments})
    elif args.component == "vad":
        emit(
            {
                "segments": [
                    {"start": row["start"], "end": row["end"]} for row in segments
                ]
            }
        )
    else:
        # For the radio pilot, non-speech is treated as music so the expensive
        # STT stage is skipped. Silero VAD inside faster-whisper makes the
        # speech decision; no remote service is used.
        emit({"outcome": "speech" if segments else "music"})
    return 0


if __name__ == "__main__":
    raise SystemExit(main())