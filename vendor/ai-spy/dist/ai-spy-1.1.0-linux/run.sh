#!/usr/bin/env bash
if ! command -v node &> /dev/null; then
  echo "Error: Node.js (v18+) is required."
  exit 1
fi
echo "Starting AI-Spy Console at http://localhost:4177 ..."
node server.mjs
