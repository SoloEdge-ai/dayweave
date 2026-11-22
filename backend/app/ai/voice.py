"""Transcribe bounded audio locally; only the editable text is returned to the browser."""
from functools import lru_cache
from io import BytesIO
import os
from pathlib import Path
from threading import BoundedSemaphore

from fastapi import APIRouter, Depends, File, Form, Request, UploadFile

from app.auth import require_admin
from app.i18n import DomainError, request_locale

router = APIRouter(prefix="/api/ai", dependencies=[Depends(require_admin)])
MAX_AUDIO = 20 * 1024 * 1024
MAX_SECONDS = 120
RATE = 16000
slot = BoundedSemaphore(1)


def demuxer(blob):
    if blob[:4] == b"RIFF" and blob[8:12] == b"WAVE":
        return "wav"
    if blob.startswith(b"OggS"):
        return "ogg"
    if blob.startswith(b"fLaC"):
        return "flac"
    if blob.startswith(b"\x1a\x45\xdf\xa3"):
        return "matroska"
    if blob[4:8] == b"ftyp":
        return "mov"
    if len(blob) >= 2 and blob[0] == 255 and (blob[1] & 0xf6) == 0xf0:
        return "aac"
    if blob.startswith(b"ID3") or (len(blob) >= 2 and blob[0] == 255 and blob[1] & 0xe0 == 0xe0):
        return "mp3"
    raise DomainError(415, "voice.format")


def decode(blob):
    import av
    import numpy as np

    kind = demuxer(blob)
    chunks = []
    samples = 0

    def append(frames):
        nonlocal samples
        for frame in frames:
            samples += frame.samples
            if samples > MAX_SECONDS * RATE:
                raise DomainError(413, "voice.length")
            chunks.append(frame.to_ndarray().reshape(-1))

    try:
        with av.open(BytesIO(blob), format=kind, options={"protocol_whitelist": "pipe"}) as container:
            if not container.streams.audio:
                raise DomainError(422, "voice.invalid")
            resampler = av.audio.resampler.AudioResampler(format="s16", layout="mono", rate=RATE)
            for decoded in container.decode(audio=0):
                decoded.pts = None
                append(resampler.resample(decoded))
            append(resampler.resample(None))
    except (av.error.FFmpegError, ValueError, OSError):
        raise DomainError(422, "voice.invalid") from None
    if not chunks:
        raise DomainError(422, "voice.empty")
    return np.concatenate(chunks).astype(np.float32) / 32768.0


@lru_cache(maxsize=1)
def model():
    from faster_whisper import WhisperModel

    root = Path(os.getenv("DAYWEAVE_SPEECH_MODEL_DIR", str(Path(__file__).resolve().parents[3] / "data/speech")))
    if not (root / "model.bin").is_file():
        raise DomainError(503, "voice.unavailable")
    return WhisperModel(str(root), device="cpu", compute_type="int8", local_files_only=True,
                        cpu_threads=min(os.cpu_count() or 2, 6))


@router.post("/transcribe")
def transcribe(request: Request, file: UploadFile = File(...), language: str | None = Form(None)):
    choice = (language or request_locale(request)).lower()
    if choice not in {"auto", "zh", "zh-cn", "ja", "en"}:
        raise DomainError(422, "settings.invalid_language")
    if not slot.acquire(blocking=False):
        raise DomainError(429, "voice.busy")
    try:
        blob = file.file.read(MAX_AUDIO + 1)
        if len(blob) > MAX_AUDIO:
            raise DomainError(413, "voice.size")
        waveform = decode(blob)
        language_code = None if choice == "auto" else choice.split("-")[0]
        segments, info = model().transcribe(waveform, language=language_code, beam_size=3, vad_filter=True,
                                            condition_on_previous_text=False)
        text = "".join(segment.text for segment in segments).strip()
        if not text:
            raise DomainError(422, "voice.empty")
        return {"text": text, "language": info.language}
    except (ImportError, RuntimeError, OSError):
        raise DomainError(503, "voice.unavailable") from None
    finally:
        file.file.close()
        slot.release()
