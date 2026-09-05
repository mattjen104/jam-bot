#!/usr/bin/env python3
"""Local-only Lore speech adapter backed by faster-whisper and Silero VAD."""

from __future__ import annotations

import argparse
import json
import math
import sys
from pathlib import Path
from typing import Iterable

from faster_whisper.audio import decode_audio
from faster_whisper.vad import VadOptions, get_speech_timestamps


COMPONENTS = {"classifier", "vad", "stt"}
SAMPLE_RATE = 16_000
VAD_OPTIONS = VadOptions(
    min_speech_duration_ms=180,
    min_silence_duration_ms=250,
    speech_pad_ms=120,
)


def emit(value: object) -> None:
    json.dump(value, sys.stdout, separators=(",", ":"))


def speech_timestamps(clip: str) -> tuple[object, list[dict[str, int]]]:
    audio = decode_audio(clip, sampling_rate=SAMPLE_RATE)
    return audio, get_speech_timestamps(audio, VAD_OPTIONS)


def rms(audio: object, start: int = 0, end: int | None = None) -> float:
    samples = audio[start:end]
    if len(samples) == 0:
        return 0.0
    return math.sqrt(float((samples * samples).mean()))


def uncovered_ranges(
    length: int, timestamps: Iterable[dict[str, int]]
) -> list[tuple[int, int]]:
    result: list[tuple[int, int]] = []
    cursor = 0
    for row in timestamps:
        start = max(cursor, min(length, row["start"]))
        end = max(start, min(length, row["end"]))
        if start > cursor:
            result.append((cursor, start))
        cursor = end
    if cursor < length:
        result.append((cursor, length))
    return result


def classify_audio(
    audio: object, timestamps: list[dict[str, int]]
) -> tuple[str, list[dict[str, float | str]]]:
    duration = len(audio) / SAMPLE_RATE
    clip_rms = rms(audio)
    # PCM decoded by faster-whisper is normalized to [-1, 1]. This floor is
    # deliberately conservative: quiet room/station noise remains silence.
    if not timestamps and clip_rms < 0.002:
        return "silence", [{"label": "silence", "start": 0.0, "end": duration}]
    speech = [
        {
            "label": "speech",
            "start": row["start"] / SAMPLE_RATE,
            "end": row["end"] / SAMPLE_RATE,
        }
        for row in timestamps
    ]
    if not timestamps:
        return "music", [{"label": "music", "start": 0.0, "end": duration}]

    gaps = uncovered_ranges(len(audio), timestamps)
    energetic_gaps = [
        (start, end)
        for start, end in gaps
        if end - start >= SAMPLE_RATE // 4 and rms(audio, start, end) >= max(0.004, clip_rms * 0.18)
    ]
    if energetic_gaps:
        music = [
            {
                "label": "music",
                "start": start / SAMPLE_RATE,
                "end": end / SAMPLE_RATE,
            }
            for start, end in energetic_gaps
        ]
        return "speech_over_music", sorted(
            [*speech, *music], key=lambda row: float(row["start"])
        )
    return "speech", speech


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

    if args.output_format != "json" or not args.clip:
        parser.error("--output-format json and an input clip are required")

    if args.component in {"classifier", "vad"}:
        audio, timestamps = speech_timestamps(args.clip)
        if args.component == "vad":
            emit(
                {
                    "segments": [
                        {
                            "start": row["start"] / SAMPLE_RATE,
                            "end": row["end"] / SAMPLE_RATE,
                        }
                        for row in timestamps
                    ]
                }
            )
        else:
            outcome, segments = classify_audio(audio, timestamps)
            emit({"outcome": outcome, "segments": segments})
        return 0

    if not args.model:
        parser.error("--model is required for stt")
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

    emit({"segments": segments})
    return 0


if __name__ == "__main__":
    raise SystemExit(main())