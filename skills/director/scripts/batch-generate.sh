#!/usr/bin/env bash
#
# Batch video generation for short film projects.
# Reads a prompts JSON file and sequentially submits each shot via ironlabs-cli.mjs.
#
# Usage:
#   bash batch-generate.sh --project <project-id> --ratio <ratio> --prompts-file <prompts.json>
#
# Prompts JSON format:
#   [
#     { "shot_id": "S1", "prompt": "...", "duration": 15 },
#     { "shot_id": "S2", "prompt": "...", "duration": 15, "materials": "1234567890:first_frame" },
#     ...
#   ]
# "duration" is optional and defaults to 15s. "materials" is optional; format is
# "<material-id:role,...>" with IDs from `ironlabs-cli.mjs material upload`.
#
# Generation is synchronous: each shot blocks for its full render (minutes for
# video) before the next one starts, so a long batch takes the sum of its shots.
#
# Environment:
#   IRONLABS_API_KEY      Required
#   IRONLABS_BASE_URL     Optional (default: https://www.chat.ironlabs.ai/api/v1)

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# An array, not a string: the plugin path can contain spaces, and an unquoted
# "$CLI" would word-split it into broken arguments.
CLI=(node "${SCRIPT_DIR}/../../ironlabs-gen/ironlabs-cli.mjs")

# ---- Parse args ----
PROJECT=""
RATIO="16:9"
PROMPTS_FILE=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --project)      PROJECT="$2";      shift 2 ;;
    --ratio)        RATIO="$2";        shift 2 ;;
    --prompts-file) PROMPTS_FILE="$2"; shift 2 ;;
    *)              echo "Unknown arg: $1"; exit 1 ;;
  esac
done

if [[ -z "$PROMPTS_FILE" ]]; then
  echo "Error: --prompts-file is required."
  echo "Usage: bash batch-generate.sh --project <id> --ratio <ratio> --prompts-file <prompts.json>"
  exit 1
fi

if [[ ! -f "$PROMPTS_FILE" ]]; then
  echo "Error: File not found: $PROMPTS_FILE"
  exit 1
fi

if [ -z "${IRONLABS_API_KEY:-}" ]; then
  echo "Error: IRONLABS_API_KEY is not set. Run /ironlabs:setup first." >&2
  exit 1
fi

# ---- Read prompts ----
SHOT_COUNT=$(jq 'length' "$PROMPTS_FILE")
echo "=== Batch generation: $SHOT_COUNT shots ==="
echo "Project: ${PROJECT:-'(none)'}"
echo "Ratio: $RATIO"
echo ""

# ---- Results tracking ----
RESULTS=()
FAILED=0

for i in $(seq 0 $((SHOT_COUNT - 1))); do
  SHOT_ID=$(jq -r  ".[$i].shot_id"                  "$PROMPTS_FILE")
  PROMPT=$(jq -r   ".[$i].prompt"                   "$PROMPTS_FILE")
  # Default to the recommended 15s segment. Without this, a shot with no
  # "duration" yielded the literal string "null" and sent `--duration null`.
  DURATION=$(jq -r  ".[$i].duration // 15"          "$PROMPTS_FILE")
  MATERIALS=$(jq -r ".[$i].materials // empty"      "$PROMPTS_FILE")
  MODEL=$(jq -r    ".[$i].model // empty"           "$PROMPTS_FILE")

  echo "--- [$((i + 1))/$SHOT_COUNT] $SHOT_ID (${DURATION}s) ---"

  # Build CLI args
  CLI_ARGS=(task create --prompt "$PROMPT" --duration "$DURATION" --ratio "$RATIO")
  if [[ -n "${MATERIALS:-}" ]]; then
    CLI_ARGS+=(--materials "$MATERIALS")
  fi
  if [[ -n "${MODEL:-}" ]]; then
    CLI_ARGS+=(--model "$MODEL")
  fi

  # Both image and video generation are synchronous — this call blocks for the
  # whole render (minutes for video) and returns the finished asset. There is no
  # pending state left to poll.
  #
  # stderr is captured rather than discarded: the CLI reports the actual reason a
  # generation failed there (bad model, insufficient balance, unsupported
  # duration), and throwing it away left every failure reading "cli error".
  CLI_STDERR=$(mktemp)
  TASK_JSON=$("${CLI[@]}" "${CLI_ARGS[@]}" 2>"$CLI_STDERR") || {
    echo "[FAILED] $SHOT_ID — $(tail -n 3 "$CLI_STDERR" | tr '\n' ' ')"
    rm -f "$CLI_STDERR"
    FAILED=$((FAILED + 1))
    RESULTS+=("$SHOT_ID|FAILED|—|cli error")
    echo ""
    echo "Stopping batch — fix the issue and re-run."
    break
  }
  rm -f "$CLI_STDERR"

  TASK_ID=$(echo "$TASK_JSON" | jq -r '.task.id // empty' 2>/dev/null)
  if [[ -z "$TASK_ID" ]]; then
    echo "[FAILED] $SHOT_ID — No task ID in response"
    FAILED=$((FAILED + 1))
    RESULTS+=("$SHOT_ID|FAILED|—|no task id")
    echo ""
    echo "Stopping batch — fix the issue and re-run."
    break
  fi

  # `task create` already returned the finished asset, so the record is on disk.
  RESULT_JSON=$("${CLI[@]}" task result "$TASK_ID" 2>/dev/null) || {
    echo "[FAILED] $SHOT_ID — Could not read back result"
    FAILED=$((FAILED + 1))
    RESULTS+=("$SHOT_ID|FAILED|$TASK_ID|no result")
    continue
  }

  VIDEO_URL=$(echo "$RESULT_JSON" | jq -r '.videoUrl // .imageUrl // "—"' 2>/dev/null || echo "—")

  echo "[SUCCESS] $SHOT_ID → $VIDEO_URL"
  RESULTS+=("$SHOT_ID|SUCCESS|$TASK_ID|$VIDEO_URL")
  echo ""
done

# ---- Summary ----
echo ""
echo "========================================="
echo "  BATCH GENERATION SUMMARY"
echo "========================================="
printf "%-8s %-10s %-14s %s\n" "Shot" "Status" "Task ID" "URL"
printf "%-8s %-10s %-14s %s\n" "----" "------" "-------" "---"

# ${RESULTS[@]+...} guards the empty-array case: under `set -u`, bash 3.2 — still
# the default /bin/bash on macOS — treats "${RESULTS[@]}" on an empty array as an
# unbound variable and aborts before printing the summary.
for entry in ${RESULTS[@]+"${RESULTS[@]}"}; do
  IFS='|' read -r shot status task_id url <<< "$entry"
  printf "%-8s %-10s %-14s %s\n" "$shot" "$status" "$task_id" "$url"
done

echo ""
echo "Total: $((${#RESULTS[@]} - FAILED))/$SHOT_COUNT succeeded, $FAILED failed"

if [[ $FAILED -gt 0 ]]; then
  exit 1
fi
