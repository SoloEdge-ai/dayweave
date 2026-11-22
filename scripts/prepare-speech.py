"""Download the pinned multilingual Whisper model used by the offline speech endpoint."""
import argparse
import hashlib
from pathlib import Path
import shutil
import time
from urllib.request import Request, urlopen

REPOSITORY = "https://huggingface.co/Systran/faster-whisper-small/resolve/"
REVISION = "536b0662742c02347bc0e980a01041f333bce120"
MODEL_SHA256 = "3e305921506d8872816023e4c273e75d2419fb89b24da97b4fe7bce14170d671"
FILES = {"config.json": 2370, "tokenizer.json": 2203239, "vocabulary.txt": 459861, "model.bin": 483546902}


def valid(path, length):
    if not path.is_file() or path.stat().st_size != length:
        return False
    if path.name.startswith("model.bin"):
        with path.open("rb") as source:
            return hashlib.file_digest(source, "sha256").hexdigest() == MODEL_SHA256
    return True


def prepare(destination):
    destination.mkdir(parents=True, exist_ok=True)
    for name, length in FILES.items():
        path = destination / name
        if valid(path, length):
            continue
        part = path.with_suffix(path.suffix + ".partial")
        for attempt in range(3):
            try:
                url = f"{REPOSITORY}{REVISION}/{name}?download=true"
                with urlopen(Request(url, headers={"User-Agent": "DayWeave speech installer"}), timeout=120) as source:
                    with part.open("wb") as target:
                        shutil.copyfileobj(source, target, 1024 * 1024)
                if not valid(part, length):
                    raise ValueError("Unexpected model file length or digest")
                part.replace(path)
                break
            except (OSError, ValueError):
                part.unlink(missing_ok=True)
                if attempt == 2:
                    raise
                time.sleep(2 ** attempt)
        print(f"Verified {name}", flush=True)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("destination", type=Path)
    prepare(parser.parse_args().destination)
