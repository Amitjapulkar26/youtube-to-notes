#!/usr/bin/env python3
"""
whisper_worker.py — Faster-Whisper transcription worker for NoteCraft AI

Outputs structured JSON to stdout.
Progress and logs go to stderr.

Usage:
  python whisper_worker.py --audio path/to/audio.wav --model base
"""

import sys
import json
import argparse
import os
import time

def emit_progress(stage, percent):
    """Emit progress to stderr for Node.js to capture"""
    print(f"PROGRESS|{stage}|{percent}", file=sys.stderr, flush=True)

def emit_info(message):
    """Emit info message to stderr"""
    print(f"INFO|{message}", file=sys.stderr, flush=True)

def emit_result(result):
    """Emit JSON result to stdout"""
    print(json.dumps(result, ensure_ascii=False), flush=True)

def main():
    parser = argparse.ArgumentParser(description='Whisper transcription worker')
    parser.add_argument('--audio', required=True, help='Path to audio file')
    parser.add_argument('--model', default='base', help='Whisper model size (tiny, base, small, medium)')
    args = parser.parse_args()

    audio_path = args.audio
    model_size = args.model

    # Validate audio file
    if not os.path.exists(audio_path):
        emit_result({"success": False, "error": f"Audio file not found: {audio_path}"})
        sys.exit(1)

    file_size = os.path.getsize(audio_path)
    if file_size == 0:
        emit_result({"success": False, "error": "Audio file is empty"})
        sys.exit(1)

    emit_info(f"Audio file: {os.path.basename(audio_path)} ({file_size // 1024}KB)")
    emit_info(f"Model: {model_size}")
    emit_progress("loading", 0)

    try:
        from faster_whisper import WhisperModel
    except ImportError:
        emit_result({
            "success": False,
            "error": "faster-whisper is not installed. Run: pip install faster-whisper"
        })
        sys.exit(1)

    # Load model
    emit_info("Loading Whisper model (first time may download model files)...")
    emit_progress("loading", 5)

    try:
        model = WhisperModel(model_size, device="cpu", compute_type="int8")
    except Exception as e:
        emit_result({"success": False, "error": f"Failed to load Whisper model: {str(e)}"})
        sys.exit(1)

    emit_progress("loading", 15)
    emit_info("Model loaded. Starting transcription...")

    # Transcribe
    try:
        segments_gen, info = model.transcribe(
            audio_path,
            beam_size=5,
            vad_filter=True,
            vad_parameters=dict(min_silence_duration_ms=500)
        )

        language = info.language
        duration = info.duration
        emit_info(f"Detected language: {language}, Duration: {duration:.0f}s")
        emit_progress("transcribing", 20)

        segments = []
        full_text = []
        total_duration = max(duration, 1)
        last_pct = 20

        for seg in segments_gen:
            segments.append({
                "start": round(seg.start, 2),
                "end": round(seg.end, 2),
                "text": seg.text.strip()
            })
            full_text.append(seg.text.strip())

            # Calculate real progress based on segment position
            current_pct = 20 + int((seg.end / total_duration) * 75)
            current_pct = min(current_pct, 95)
            if current_pct > last_pct + 2:
                emit_progress("transcribing", current_pct)
                last_pct = current_pct

        emit_progress("transcribing", 100)

        text = " ".join(full_text)
        emit_info(f"Transcription complete: {len(segments)} segments, {len(text)} chars")

        emit_result({
            "success": True,
            "language": language,
            "duration": round(duration, 2),
            "segments": segments,
            "text": text
        })

    except Exception as e:
        emit_result({"success": False, "error": f"Transcription failed: {str(e)}"})
        sys.exit(1)

if __name__ == "__main__":
    main()
