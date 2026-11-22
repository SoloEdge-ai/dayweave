#!/bin/sh
# Exercise the built image in its own temporary Compose project and data volume.
set -eu
cd "$(dirname "$0")/.."
export COMPOSE_FILE=docker-compose.yml
export COMPOSE_PROJECT_NAME="dayweave-test-$(date -u +%s)-$$"
export DAYWEAVE_PORT=0 DAYWEAVE_COOKIE_SECURE=0 DAYWEAVE_PROXY_IP=127.0.0.1
export DAYWEAVE_ADMIN_PASSWORD=only-for-the-disposable-container
export DAYWEAVE_TRUSTED_HTTP_BASES=http://127.0.0.1:19197/v1
test_project=$COMPOSE_PROJECT_NAME
recovery_project="$test_project-recovery"
backup_dir=$(mktemp -d)
archive=
clean_up() {
    docker compose -p "$test_project" down -v --rmi local >/dev/null
    docker compose -p "$recovery_project" down -v --rmi local >/dev/null
    if [ -n "$archive" ]; then rm -f -- "$archive"; fi
    rmdir "$backup_dir"
}
trap clean_up EXIT
docker compose up -d --build --wait
docker compose exec -T dayweave python - seed < tests/container_state.py
docker compose restart dayweave
docker compose up -d --wait
docker compose exec -T dayweave python - verify < tests/container_state.py
archive=$(DAYWEAVE_BACKUP_DIR="$backup_dir" sh scripts/backup.sh)
docker compose -p "$recovery_project" build
docker compose -p "$recovery_project" run --rm --no-deps -T dayweave sh -c 'test -z "$(ls -A /data)" && tar -xzf - -C /data' < "$archive"
docker compose -p "$recovery_project" up -d --wait
docker compose -p "$recovery_project" exec -T dayweave python - verify < tests/container_state.py
