import tempfile
import unittest
import wave
from pathlib import Path

import numpy

from adapter import SAMPLE_RATE, classify_audio, speech_timestamps


def fixture(*parts: tuple[float, float]) -> numpy.ndarray:
    """Build deterministic mono fixture parts of (seconds, amplitude)."""
    samples = []
    for seconds, amplitude in parts:
        count = round(seconds * SAMPLE_RATE)
        time = numpy.arange(count, dtype=numpy.float32) / SAMPLE_RATE
        samples.append((amplitude * numpy.sin(2 * numpy.pi * 220 * time)).astype(numpy.float32))
    return numpy.concatenate(samples)


def quiet_speech_fixture() -> numpy.ndarray:
    """Low-amplitude voiced syllables with changing pitch and natural pauses."""
    time = numpy.arange(SAMPLE_RATE * 3, dtype=numpy.float32) / SAMPLE_RATE
    audio = numpy.zeros_like(time)
    for start, end, pitch in ((0.15, 0.75, 115), (0.9, 1.5, 145), (1.65, 2.35, 105), (2.5, 2.9, 160)):
        selected = (time >= start) & (time < end)
        local_time = time[selected] - start
        envelope = numpy.minimum(1, local_time / 0.04) * numpy.minimum(1, (end - start - local_time) / 0.06)
        harmonics = sum(
            numpy.sin(2 * numpy.pi * pitch * harmonic * local_time) / harmonic
            for harmonic in range(1, 12)
        )
        audio[selected] = 0.03 * envelope * (0.65 + 0.35 * numpy.sin(2 * numpy.pi * 4 * local_time) ** 2) * harmonics
    return audio


def write_wav(path: Path, audio: numpy.ndarray) -> None:
    with wave.open(str(path), "wb") as output:
        output.setnchannels(1)
        output.setsampwidth(2)
        output.setframerate(SAMPLE_RATE)
        output.writeframes((audio * 32767).astype("<i2").tobytes())


class DedicatedAudioClassifierTest(unittest.TestCase):
    def test_silence_fixture(self) -> None:
        audio = numpy.zeros(SAMPLE_RATE, dtype=numpy.float32)
        self.assertEqual(classify_audio(audio, [])[0], "silence")

    def test_music_fixture(self) -> None:
        self.assertEqual(classify_audio(fixture((1, 0.15)), [])[0], "music")

    def test_quiet_speech_fixture_does_not_require_words(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "quiet-speech.wav"
            write_wav(path, quiet_speech_fixture())
            audio, timestamps = speech_timestamps(str(path))
            self.assertTrue(timestamps)
            self.assertIn(classify_audio(audio, timestamps)[0], {"speech", "speech_over_music"})

    def test_speech_over_music_fixture(self) -> None:
        audio = fixture((0.5, 0.04), (1, 0.12), (0.5, 0.04))
        timestamps = [{"start": 8000, "end": 24000}]
        outcome, segments = classify_audio(audio, timestamps)
        self.assertEqual(outcome, "speech_over_music")
        self.assertEqual({row["label"] for row in segments}, {"speech", "music"})

    def test_fixture_wav_is_not_retained_by_classifier(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "fixture.wav"
            write_wav(path, fixture((0.2, 0.1)))
            before = path.read_bytes()
            classify_audio(fixture((0.2, 0.1)), [])
            self.assertEqual(path.read_bytes(), before)


if __name__ == "__main__":
    unittest.main()