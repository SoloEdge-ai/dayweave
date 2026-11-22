"""Email ownership challenges shared by registration and password recovery."""
import hashlib
import hmac
import logging
import os
import secrets
import smtplib
import ssl
import time
from dataclasses import dataclass
from email.message import EmailMessage
from email.utils import formatdate, make_msgid
from typing import Annotated, Literal

from email_validator import EmailNotValidError, validate_email
from pydantic import AfterValidator, StringConstraints
from sqlalchemy import delete, select

from .db import data_dir
from .i18n import DomainError, translate
from .models import Account, EmailChallenge
from .records import lock_for_write
from .secret_files import private_key

Purpose = Literal["register", "reset"]
TTL = 600
RESEND_SECONDS = 60
MAX_GUESSES = 5


def normalize_email(value: str) -> str:
    try:
        result = validate_email(value.strip(), check_deliverability=False, allow_smtputf8=False)
    except EmailNotValidError:
        raise ValueError("auth.email_invalid") from None
    return result.ascii_email.lower()


Email = Annotated[str, StringConstraints(max_length=320), AfterValidator(normalize_email)]
Code = Annotated[str, StringConstraints(pattern=r"^[0-9]{8}$")]


@dataclass(frozen=True)
class MailServer:
    host: str
    port: int
    sender: str
    mode: str

    @classmethod
    def configured(cls):
        host = os.getenv("DAYWEAVE_SMTP_HOST", "").strip()
        mode = os.getenv("DAYWEAVE_SMTP_SECURITY", "starttls")
        try:
            port = int(os.getenv("DAYWEAVE_SMTP_PORT") or (465 if mode == "tls" else 587))
            sender = normalize_email(os.environ.get("DAYWEAVE_MAIL_FROM", ""))
        except ValueError:
            raise DomainError(503, "auth.mail_unavailable") from None
        if (not host or not 0 < port <= 65535 or mode not in {"starttls", "tls", "loopback"}
                or (mode == "loopback" and host not in {"127.0.0.1", "::1"})
                or bool(os.getenv("DAYWEAVE_SMTP_USER")) != bool(os.getenv("DAYWEAVE_SMTP_PASSWORD"))):
            raise DomainError(503, "auth.mail_unavailable")
        return cls(host, port, sender, mode)

    def send(self, recipient, purpose, code, language):
        message = EmailMessage()
        message["Date"] = formatdate(localtime=False, usegmt=True)
        message["Message-ID"] = make_msgid(domain=self.sender.rsplit("@", 1)[1])
        message["From"] = self.sender
        message["To"] = recipient
        message["Subject"] = translate("mail." + purpose, language)
        message.set_content(translate("mail.body", language, verification=code))
        context = ssl.create_default_context()
        if self.mode == "tls":
            connection = smtplib.SMTP_SSL(self.host, self.port, timeout=10, context=context)
        else:
            connection = smtplib.SMTP(self.host, self.port, timeout=10)
        with connection as smtp:
            if self.mode == "starttls":
                smtp.starttls(context=context)
            if user := os.getenv("DAYWEAVE_SMTP_USER"):
                smtp.login(user, os.environ["DAYWEAVE_SMTP_PASSWORD"])
            smtp.send_message(message)


def fingerprint(email, purpose, code):
    key = private_key(data_dir() / ".email-code-key", lambda: secrets.token_bytes(32))
    return hmac.new(key, f"{email}\0{purpose}\0{code}".encode(), hashlib.sha256).hexdigest()


def deliver(server, email, purpose, code, language):
    try:
        server.send(email, purpose, code, language)
    except (OSError, smtplib.SMTPException):
        logging.getLogger(__name__).error("Verification email delivery failed. Check SMTP configuration and connectivity.")


def issue(db, background, email, purpose, language):
    server = MailServer.configured()
    lock_for_write(db)
    now = int(time.time())
    db.execute(delete(EmailChallenge).where(EmailChallenge.issued_at <= now - TTL))
    challenge = db.get(EmailChallenge, (email, purpose))
    if challenge and now - challenge.issued_at < RESEND_SECONDS:
        return
    code = f"{secrets.randbelow(100_000_000):08d}"
    digest = fingerprint(email, purpose, code)
    if not challenge:
        challenge = EmailChallenge(email=email, purpose=purpose)
        db.add(challenge)
    challenge.digest, challenge.issued_at, challenge.attempts = digest, now, 0
    exists = db.scalar(select(Account.id).where(Account.email == email)) is not None
    db.commit()
    if exists == (purpose == "reset"):
        background.add_task(deliver, server, email, purpose, code, language)


def consume(db, email, purpose, code):
    lock_for_write(db)
    challenge = db.get(EmailChallenge, (email, purpose))
    if not challenge or int(time.time()) >= challenge.issued_at + TTL or challenge.attempts >= MAX_GUESSES:
        raise DomainError(400, "auth.invalid_code")
    if not hmac.compare_digest(challenge.digest, fingerprint(email, purpose, code)):
        challenge.attempts += 1
        db.commit()
        raise DomainError(400, "auth.invalid_code")
    db.delete(challenge)
