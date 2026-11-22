#!/bin/sh
set -eu
umask 077
cd "$(dirname "$0")/.."
output_dir=${DAYWEAVE_BACKUP_DIR:-backups}
mkdir -p "$output_dir"
dest="$output_dir/dayweave-$(date -u '+%Y%m%dT%H%M%SZ')-$$.tar.gz"
tmp="$dest.partial"
was_running=$(docker compose ps --status running -q dayweave)
finish() {
    rm -f -- "$tmp"
    if [ -n "$was_running" ]; then docker compose start dayweave >/dev/null; fi
}
trap finish EXIT
trap 'exit 130' INT
trap 'exit 143' TERM
if [ -n "$was_running" ]; then docker compose stop dayweave >/dev/null; fi
docker compose run --rm --no-deps -T dayweave tar -C /data -czf - . > "$tmp"
tar -tzf "$tmp" >/dev/null
mv -- "$tmp" "$dest"
echo "$dest"
