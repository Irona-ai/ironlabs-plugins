#!/usr/bin/env bash
# PreToolUse hook: block IronLabs script calls when no API key is reachable.

set -euo pipefail

INPUT=$(cat)

COMMAND=$(echo "$INPUT" | jq -r '.tool_input.command // empty' 2>/dev/null || echo "")

# Every script in this plugin that needs IRONLABS_API_KEY. analyze.mjs and
# material-ingest.mjs authenticate the same way as the CLI and were previously
# unguarded, so they failed with a raw error instead of the setup hint.
case "$COMMAND" in
  *ironlabs-cli.mjs*|*analyze.mjs*|*material-ingest.mjs*) ;;
  *) exit 0 ;;
esac

# If the key is in the environment, allow.
if [ -n "${IRONLABS_API_KEY:-}" ]; then
  exit 0
fi

# The scripts also read a .env file from the working directory, so a key
# configured that way works even with nothing exported. Blocking on the env var
# alone rejected calls that would have succeeded.
if [ -f "$PWD/.env" ] && grep -qE '^[[:space:]]*IRONLABS_API_KEY[[:space:]]*=[[:space:]]*[^[:space:]]' "$PWD/.env" 2>/dev/null; then
  exit 0
fi

# Block and guide user
jq -n '{
  decision: "block",
  reason: "IRONLABS_API_KEY is not set (checked the environment and ./.env). Run /ironlabs:setup to configure your API key before using IronLabs skills."
}'
