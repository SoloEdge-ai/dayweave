"""Capture SMTP messages for the disposable Playwright server."""
import json
import os
import socket
from contextlib import contextmanager
from email import policy
from email.parser import BytesParser
from pathlib import Path

from aiosmtpd.controller import Controller


@contextmanager
def mailbox(directory):
    path = Path(directory) / "mail.jsonl"
    path.touch()

    class Receiver:
        first_greeting = True
        reject_first_signup = True

        async def handle_EHLO(self, server, session, envelope, hostname, responses):
            # Verify that a signup still receives one usable code after a dropped greeting.
            if self.first_greeting:
                self.first_greeting = False
                server.transport.close()
            session.host_name = hostname
            return responses

        async def handle_DATA(self, server, session, envelope):
            message = BytesParser(policy=policy.default).parsebytes(envelope.content)
            if self.reject_first_signup and message["To"] == "second-user@example.org":
                self.reject_first_signup = False
                return "451 Temporary delivery failure"
            with path.open("a", encoding="utf-8") as output:
                print(json.dumps({"to": message["To"], "body": message.get_body().get_content()}), file=output)
            return "250 OK"

    with socket.socket() as probe:
        probe.bind(("127.0.0.1", 0))
        port = probe.getsockname()[1]
    server = Controller(Receiver(), hostname="127.0.0.1", port=port)
    os.environ.update(DAYWEAVE_SMTP_HOST="127.0.0.1", DAYWEAVE_SMTP_PORT=str(port),
                      DAYWEAVE_SMTP_SECURITY="loopback", DAYWEAVE_MAIL_FROM="fixture@example.org",
                      DAYWEAVE_SMTP_USER="", DAYWEAVE_SMTP_PASSWORD="")
    server.start()
    try:
        yield
    finally:
        server.stop()
