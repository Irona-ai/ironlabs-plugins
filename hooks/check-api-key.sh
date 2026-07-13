#!/usr/bin/env bash
set -euo pipefail

COMMAND=$(cat | jq -r '.tool_input.command // empty')

# Only intercept IronLabs skill scripts
if [[ "$COMMAND" != *ironlabs-cli.mjs* ]] && [[ "$COMMAND" != *gemini.mjs* ]]; then
  exit 0
fi

# Block if no API key
if [ -z "${IRONLABS_API_KEY:-}" ]; then
  jq -n '{ decision: "block", reason: "IRONLABS_API_KEY is not set. Run /ironlabs:setup first." }'
  exit 0
fi

# Block if balance is zero (read from local cache — no network)
BALANCE=$(jq -r '.balance // 0' "${HOME}/.ironlabs/balance-cache.json" 2>/dev/null || echo "0")
if awk -v b="$BALANCE" 'BEGIN { exit (b > 0) }'; then
  jq -n '{ decision: "block", reason: "No IronLabs credits remaining. Run /ironlabs:add-credits to top up." }'
  exit 0
fi

exit 0
