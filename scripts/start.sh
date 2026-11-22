#!/bin/sh
set -eu
umask 077
alembic upgrade head
exec uvicorn app.main:app --host 0.0.0.0 --port 8000 --workers 1 --no-access-log
