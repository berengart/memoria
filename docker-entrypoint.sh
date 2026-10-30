#!/bin/sh
# Sorgt dafür, dass ./data auf dem Host dem eigenen Benutzer gehört (Standard 1000:1000),
# und startet die App danach ohne Root-Rechte.
set -e
PUID="${PUID:-1000}"
PGID="${PGID:-1000}"
mkdir -p "$DATA_DIR"
if [ "$(stat -c %u "$DATA_DIR")" != "$PUID" ] || [ "$(stat -c %g "$DATA_DIR")" != "$PGID" ]; then
  chown -R "$PUID:$PGID" "$DATA_DIR"
fi
exec su-exec "$PUID:$PGID" "$@"
