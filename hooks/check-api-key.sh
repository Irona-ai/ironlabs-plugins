#!/usr/bin/env bash
# PreToolUse hook: block ironlabs-cli.mjs calls when IRONLABS_API_KEY is not set.

set -euo pipefail

INPUT=$(cat)

COMMAND=$(echo "$INPUT" | jq -r '.tool_input.command // empty')

# Only check commands that invoke ironlabs-cli.mjs
if [[ "$COMMAND" != *ironlabs-cli.mjs* ]]; then
  exit 0
fi

# If the key is configured, allow
if [ -n "${IRONLABS_API_KEY:-}" ]; then
  exit 0
fi

# Block and guide user
jq -n '{
  decision: "block",
  reason: "IRONLABS_API_KEY is not set. Run /ironlabs:setup to configure your API key before using IronLabs skills."
}'
