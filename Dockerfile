FROM node:24-bookworm-slim AS web-deps
WORKDIR /web
COPY frontend/package*.json ./
RUN npm ci --no-audit --no-fund

FROM node:24-bookworm-slim AS codex-cli
RUN npm install --prefix /opt/cli --no-audit --no-fund @openai/codex@0.155.1 \
    && mkdir /out \
    && find /opt/cli -type f -path '*/bin/codex' -exec cp {} /out/codex \; \
    && /out/codex --version

FROM web-deps AS web
COPY frontend/ ./
RUN npm run build

FROM python:3.12-slim-bookworm AS speech-weights
COPY scripts/prepare-speech.py /tmp/prepare-speech.py
RUN python /tmp/prepare-speech.py /opt/dayweave/speech

FROM python:3.12-slim-bookworm AS python-deps
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 DAYWEAVE_DATA_DIR=/data DAYWEAVE_STATIC_DIR=/opt/dayweave/web
WORKDIR /opt/dayweave/backend
COPY backend/requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt && useradd --create-home --uid 10001 dayweave && install -d -o dayweave -g dayweave -m 0700 /data

FROM python-deps AS runtime
ENV DAYWEAVE_SPEECH_MODEL_DIR=/opt/dayweave/speech HF_HUB_OFFLINE=1
COPY --from=speech-weights /opt/dayweave/speech /opt/dayweave/speech
COPY backend/ ./
COPY --from=codex-cli /out/codex /usr/local/bin/codex
COPY --from=web /web/dist /opt/dayweave/web
COPY scripts/start.sh /opt/dayweave/start.sh
USER dayweave
EXPOSE 8000
CMD ["sh", "/opt/dayweave/start.sh"]
