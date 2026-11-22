"""Encrypted credentials and atomic host-local key creation."""

from cryptography.fernet import Fernet, InvalidToken
from fastapi import HTTPException

from app.db import data_dir
from app.secret_files import private_key


def vault() -> Fernet:
    return Fernet(private_key(data_dir() / ".provider-key", Fernet.generate_key))


def seal(value: str) -> str:
    return vault().encrypt(value.encode()).decode()


def unseal(value: str) -> str:
    try:
        return vault().decrypt(value.encode()).decode()
    except InvalidToken:
        raise HTTPException(409, "本地凭据解密失败，请恢复与备份匹配的密钥或重新配置。")
