#!/usr/bin/env bash

# SessionStart hook: guide users based on their setup state.
# - No API key → prompt to run /ironlabs:setup
# - Has API key but no statusLine → prompt to activate credit display
# - Fully configured → silent

set -euo pipefail

# Consume stdin (SessionStart sends context JSON, we don't need it)
cat > /dev/null

HAS_KEY=false
HAS_STATUSLINE=false

# Check if API key is configured
if [ -n "${IRONLABS_API_KEY:-}" ]; then
  HAS_KEY=true
fi

# Check if statusLine is pointing to our plugin
SETTINGS_FILE="${CLAUDE_CONFIG_DIR:-$HOME/.claude}/settings.json"
if [ -f "$SETTINGS_FILE" ] && grep -q "statusLine" "$SETTINGS_FILE" 2>/dev/null && grep -q "ironlabs-plugin" "$SETTINGS_FILE" 2>/dev/null; then
  HAS_STATUSLINE=true
fi

# Case 1: New user — no API key
if [ "$HAS_KEY" = false ]; then
  echo '[IronLabs] Plugin installed but account is not connected yet. Tell the user: type /ironlabs:setup to connect your account. One sentence only.'
  exit 0
fi

# Case 2: Has key but no statusLine configured
if [ "$HAS_STATUSLINE" = false ]; then
  echo '[IronLabs] Plugin updated — real-time credit balance can be shown in the status bar. Tell the user: type /ironlabs:setup to activate it. One sentence only.'
  exit 0
fi

# Case 3: Everything configured — silent
exit 0
