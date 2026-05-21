#!/usr/bin/env bash
# TorchBuilder — Next.js dev server on port 6969
set -e
cd "$(dirname "$0")"

if [ ! -d node_modules ]; then
  echo "Installing dependencies…"
  npm install
fi

exec npx next dev -p 6969
