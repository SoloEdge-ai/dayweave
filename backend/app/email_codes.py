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
from sqlalchemy import delete, select, update

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

    def connect(self, context):
        if self.mode == "tls":
            smtp = smtplib.SMTP_SSL(self.host, self.port, timeout=10, context=context)
        else:
            smtp = smtplib.SMTP(self.host, self.port, timeout=10)
        try:
            if self.mode == "starttls":
                smtp.starttls(context=context)
            smtp.ehlo_or_helo_if_needed()
            if user := os.getenv("DAYWEAVE_SMTP_USER"):
                smtp.login(user, os.environ["DAYWEAVE_SMTP_PASSWORD"])
            return smtp
        except Exception:
            smtp.close()
            raise

    def send(self, recipient, purpose, code, language):
        context = ssl.create_default_context()
        for attempt in range(3):
            try:
                smtp = self.connect(context)
                break
            except (ConnectionError, TimeoutError, ssl.SSLEOFError, smtplib.SMTPServerDisconnected):
                if attempt == 2:
                    raise
                time.sleep(attempt + 1)
        try:
            # A lost acknowledgment after DATA is ambiguous. Submit each message only once.
            if code is not None:
                message = EmailMessage()
                message["Date"] = formatdate(localtime=False, usegmt=True)
                message["Message-ID"] = make_msgid(domain=self.sender.rsplit("@", 1)[1])
                message["From"] = self.sender
                message["To"] = recipient
                message["Subject"] = translate("mail." + purpose, language)
                message.set_content(translate("mail.body", language, verification=code))
                smtp.send_message(message)
            try:
                smtp.quit()
            except OSError:
                pass  # The relay already acknowledged the message.
        finally:
            smtp.close()


def fingerprint(email, purpose, code):
    key = private_key(data_dir() / ".email-code-key", lambda: secrets.token_bytes(32))
    return hmac.new(key, f"{email}\0{purpose}\0{code}".encode(), hashlib.sha256).hexdigest()


def issue(db, email, purpose, language):
    server = MailServer.configured()
    lock_for_write(db)
    now = int(time.time())
    db.execute(delete(EmailChallenge).where(EmailChallenge.issued_at <= now - TTL))
    challenge = db.get(EmailChallenge, (email, purpose))
    if challenge and challenge.delivery_state == "pending" and now - challenge.issued_at < 120:
        raise DomainError(409, "auth.mail_pending")
    if challenge and challenge.delivery_state == "submitted" and now - challenge.issued_at < RESEND_SECONDS:
        return

    code = f"{secrets.randbelow(100_000_000):08d}"
    digest = fingerprint(email, purpose, code)
    if not challenge:
        challenge = EmailChallenge(email=email, purpose=purpose)
        db.add(challenge)
    challenge.digest, challenge.issued_at, challenge.attempts = digest, now, 0
    challenge.delivery_state = "pending"
    exists = db.scalar(select(Account.id).where(Account.email == email)) is not None
    db.commit()  # Release the identity database before waiting on the relay.

    finish = update(EmailChallenge).where(
        EmailChallenge.email == email, EmailChallenge.purpose == purpose, EmailChallenge.digest == digest,
    )
    try:
        # Check transport and authentication even for an ineligible address.
        server.send(email, purpose, code if exists == (purpose == "reset") else None, language)
    except OSError as exc:
        logging.getLogger(__name__).error("Verification email delivery failed (%s, SMTP %s).",
                                          type(exc).__name__, getattr(exc, "smtp_code", "unavailable"))
        db.execute(finish.values(delivery_state="failed"))
        db.commit()
        raise DomainError(503, "auth.mail_delivery_failed") from None
    db.execute(finish.values(delivery_state="submitted"))
    db.commit()


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
