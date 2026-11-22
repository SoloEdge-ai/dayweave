"""Publish a host-local secret atomically, including concurrent first use."""
import os
from pathlib import Path
from tempfile import NamedTemporaryFile


def private_key(path, generate):
    if not path.exists():
        with NamedTemporaryFile(dir=path.parent, delete=False) as temp:
            candidate = Path(temp.name)
            temp.write(generate())
            temp.flush()
            os.fsync(temp.fileno())
        try:
            os.link(candidate, path)
        except FileExistsError:
            pass
        finally:
            candidate.unlink(missing_ok=True)
    return path.read_bytes()
