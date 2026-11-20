#!/usr/bin/env bash
set -euo pipefail

PORT="${PORT:-3000}"
REBUILD=0
if [ "${1:-}" = "--rebuild" ]; then
  REBUILD=1
fi

echo "=== ToobitPulse Android / Termux Standalone Launcher ==="

# 1. Auto-install Node.js LTS inside Termux if missing
if ! command -v node >/dev/null 2>&1; then
  if [ -n "${TERMUX_VERSION:-}" ] && command -v pkg >/dev/null 2>&1; then
    echo "[1/4] Installing Node.js LTS in Termux..."
    pkg update -y
    pkg install -y nodejs-lts
  else
    echo "Error: Node.js 20+ is required. Please install nodejs-lts."
    exit 1
  fi
fi

# 2. Prevent Android from sleeping the local scanner server while active
if command -v termux-wake-lock >/dev/null 2>&1; then
  termux-wake-lock || true
  trap 'command -v termux-wake-unlock >/dev/null 2>&1 && termux-wake-unlock || true' EXIT
fi

# 3. Install dependencies if node_modules does not exist
if [ ! -d "node_modules" ]; then
  echo "[2/4] Installing npm packages..."
  npm install --no-audit --no-fund
fi

# 4. Build frontend PWA + pure-ESM backend bundle if missing or --rebuild requested
if [ "$REBUILD" -eq 1 ] || [ ! -f "dist/index.html" ] || [ ! -f "dist-server/server.mjs" ]; then
  echo "[3/4] Building PWA frontend & Android standalone server bundle..."
  npm run build:android
fi

echo "[4/4] Starting ToobitPulse locally on http://localhost:${PORT}"
echo "      Open http://localhost:${PORT} in Chrome on Android and tap 'Install App'."

# Open Android browser once server responds to /api/health
if command -v termux-open-url >/dev/null 2>&1; then
  (
    for _ in $(seq 1 25); do
      if node -e "fetch('http://127.0.0.1:${PORT}/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))" 2>/dev/null; then
        termux-open-url "http://localhost:${PORT}" || true
        break
      fi
      sleep 1
    done
  ) &
fi

export NODE_ENV=production
export PORT="${PORT}"
exec node dist-server/server.mjs
