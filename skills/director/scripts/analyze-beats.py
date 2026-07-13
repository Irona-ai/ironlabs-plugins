#!/usr/bin/env python3
"""
analyze-beats.py — Beat analysis for video editing cut points.
Extracts BPM, beat positions, section boundaries, and suggests cut points
that respect the 5–15 second clip constraint used by video generation models.

Usage:
  python analyze-beats.py <audio_file> [--min-seg 5] [--max-seg 15]

Output (JSON to stdout):
  { bpm, beats, sections, cut_points }

Dependencies:
  pip install librosa numpy soundfile
"""

import sys
import json
import argparse

try:
    import librosa
    import numpy as np
    import soundfile as sf
except ImportError:
    print(json.dumps({"error": "Missing deps — run: pip install librosa numpy soundfile"}))
    sys.exit(1)


def analyze(audio_path: str, min_seg: float, max_seg: float) -> dict:
    y, sr = librosa.load(audio_path, sr=None)
    duration = librosa.get_duration(y=y, sr=sr)

    # Beat tracking
    tempo, beat_frames = librosa.beat.beat_track(y=y, sr=sr)
    beat_times = librosa.frames_to_time(beat_frames, sr=sr).tolist()
    bpm = float(np.round(tempo, 1))

    # Section boundaries via spectral novelty
    hop_length = 512
    mfcc = librosa.feature.mfcc(y=y, sr=sr, hop_length=hop_length, n_mfcc=13)
    novelty = np.diff(mfcc, axis=1)
    novelty_curve = np.sqrt((novelty ** 2).sum(axis=0))
    # Smooth and find peaks
    from scipy.signal import find_peaks  # type: ignore
    novelty_smooth = np.convolve(novelty_curve, np.ones(20) / 20, mode="same")
    peak_frames, _ = find_peaks(novelty_smooth, distance=sr // hop_length * 5)
    section_times = librosa.frames_to_time(peak_frames, sr=sr).tolist()
    sections = [0.0] + section_times + [duration]

    # Build cut points respecting [min_seg, max_seg] constraint
    cut_points = [0.0]
    last = 0.0
    # Prefer beat-aligned boundaries near section changes
    candidates = sorted(set(beat_times + section_times))
    for t in candidates:
        gap = t - last
        if gap >= min_seg:
            if gap <= max_seg:
                cut_points.append(round(t, 3))
                last = t
            elif gap > max_seg:
                # Force a cut at max_seg even if not beat-aligned
                forced = round(last + max_seg, 3)
                cut_points.append(forced)
                last = forced
    if duration - last >= min_seg:
        cut_points.append(round(duration, 3))

    return {
        "bpm": bpm,
        "duration": round(duration, 3),
        "beats": [round(b, 3) for b in beat_times],
        "sections": [round(s, 3) for s in sections],
        "cut_points": cut_points,
    }


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("audio_file")
    parser.add_argument("--min-seg", type=float, default=5.0)
    parser.add_argument("--max-seg", type=float, default=15.0)
    args = parser.parse_args()

    try:
        result = analyze(args.audio_file, args.min_seg, args.max_seg)
        print(json.dumps(result, indent=2))
    except Exception as e:
        print(json.dumps({"error": str(e)}))
        sys.exit(1)


if __name__ == "__main__":
    main()
