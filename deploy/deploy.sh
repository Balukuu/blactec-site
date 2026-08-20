#!/usr/bin/env bash
# Syncs the static site to a GCP VM running Nginx.
# Usage: deploy/deploy.sh <user>@<vm-external-ip-or-hostname> [remote_path]
set -euo pipefail

TARGET="${1:?Usage: deploy.sh <user>@<host> [remote_path]}"
REMOTE_PATH="${2:-/var/www/blactec-site}"
SITE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

rsync -avz --delete \
  --exclude '.git' \
  --exclude 'node_modules' \
  --exclude 'src' \
  --exclude 'cloudflare-worker' \
  --exclude 'deploy' \
  --exclude 'assets/marketing-kit' \
  --exclude 'package.json' \
  --exclude 'package-lock.json' \
  --exclude 'tsconfig.json' \
  --exclude '*.map' \
  "$SITE_DIR/" "$TARGET:$REMOTE_PATH/"

echo "Synced to $TARGET:$REMOTE_PATH"
