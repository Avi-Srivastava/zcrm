#!/bin/bash

# Auto-pull and restart script
# This pulls latest code every 5 minutes and restarts if there are changes

cd /home/user/my-app

echo "[AutoPull] Starting auto-pull watcher..."

while true; do
  # Fetch latest
  git fetch origin claude/email-crm-sync-boF8I 2>/dev/null

  # Check if there are changes
  LOCAL=$(git rev-parse HEAD)
  REMOTE=$(git rev-parse origin/claude/email-crm-sync-boF8I)

  if [ "$LOCAL" != "$REMOTE" ]; then
    echo "[AutoPull] $(date '+%Y-%m-%d %H:%M:%S') New changes detected, pulling..."
    git pull origin claude/email-crm-sync-boF8I

    # Reinstall dependencies if package.json changed
    if git diff --name-only HEAD@{1} HEAD | grep -q "package.json"; then
      echo "[AutoPull] package.json changed, running npm install..."
      npm install
    fi

    # Restart the sync process
    echo "[AutoPull] Restarting crm-sync..."
    pm2 restart crm-sync
  fi

  # Wait 5 minutes
  sleep 300
done
