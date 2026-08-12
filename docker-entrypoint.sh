#!/bin/sh
set -e

# The image runs the app as the unprivileged `node` user, but a data volume
# or backups bind mount from before that change (or a fresh bind mount
# created by the Docker daemon, which defaults to root) may still be owned
# by root. Fix that once, as root, then permanently drop to `node` for the
# actual process — so upgrading an existing deployment doesn't require any
# manual `chown` on the host.
if [ "$(id -u)" = '0' ]; then
  chown -R node:node /app/data /app/backups
  exec su-exec node "$0" "$@"
fi

exec "$@"
