"""Encrypted credentials and atomic host-local key creation."""

import os
from pathlib import Path
from tempfile import NamedTemporaryFile

from cryptography.fernet import Fernet, InvalidToken
from fastapi import HTTPException

from app.db import data_dir


def vault() -> Fernet:
    path = data_dir() / ".provider-key"
    path.parent.mkdir(parents=True, exist_ok=True)
    if not path.exists():
        with NamedTemporaryFile(dir=path.parent, delete=False) as temp:
            candidate = Path(temp.name)
            temp.write(Fernet.generate_key())
            temp.flush()
            os.fsync(temp.fileno())
        try:
            os.link(candidate, path)
        except FileExistsError:
            pass
        finally:
            candidate.unlink(missing_ok=True)
    return Fernet(path.read_bytes())


def seal(value: str) -> str:
    return vault().encrypt(value.encode()).decode()


def unseal(value: str) -> str:
    try:
        return vault().decrypt(value.encode()).decode()
    except InvalidToken:
        raise HTTPException(409, "本地凭据解密失败，请恢复与备份匹配的密钥或重新配置。")
