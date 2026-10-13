#!/bin/sh
# Makes the data dir writable by uid 1000, then runs the server as that user.
set -e

if [ "$(id -u)" = "0" ]; then
  mkdir -p "$ARIA_DATA_DIR"
  chown 1000:1000 "$ARIA_DATA_DIR"
  exec setpriv --reuid=1000 --regid=1000 --clear-groups "$@"
fi

exec "$@"
