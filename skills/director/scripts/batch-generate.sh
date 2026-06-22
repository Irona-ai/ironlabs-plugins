#!/usr/bin/env bash
#
# Batch video generation for short film projects.
# Reads a prompts JSON file and sequentially submits each shot via renoise-cli.mjs.
#
# Usage:
#   bash batch-generate.sh --project <project-id> --ratio <ratio> --prompts-file <prompts.json>
#
# Prompts JSON format:
#   [
#     { "shot_id": "S1", "prompt": "...", "duration": 8 },
#     { "shot_id": "S2", "prompt": "...", "duration": 10, "materials": "1234567890:ref_image" },
#     ...
#   ]
# The "materials" field is optional. Format: "<material-id:role,...>" (material IDs from renoise-cli.mjs material upload).
#
# Environment:
#   IRONLABS_API_KEY      Required
#   IRONLABS_BASE_URL     Optional (default: https://chat.irona.ai/api/v1)

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CLI="node ${SCRIPT_DIR}/../../renoise-gen/renoise-cli.mjs"

# ---- Parse args ----
PROJECT=""
RATIO="16:9"
PROMPTS_FILE=""
TIMEOUT=600

while [[ $# -gt 0 ]]; do
  case "$1" in
    --project)      PROJECT="$2";      shift 2 ;;
    --ratio)        RATIO="$2";        shift 2 ;;
    --prompts-file) PROMPTS_FILE="$2"; shift 2 ;;
    --timeout)      TIMEOUT="$2";      shift 2 ;;
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
  SHOT_ID=$(jq -r  ".[$i].shot_id"              "$PROMPTS_FILE")
  PROMPT=$(jq -r   ".[$i].prompt"               "$PROMPTS_FILE")
  DURATION=$(jq    ".[$i].duration"             "$PROMPTS_FILE")
  MATERIALS=$(jq -r ".[$i].materials // empty"  "$PROMPTS_FILE")
  MODEL=$(jq -r    ".[$i].model // empty"       "$PROMPTS_FILE")

  echo "--- [$((i + 1))/$SHOT_COUNT] $SHOT_ID (${DURATION}s) ---"

  # Build CLI args
  CLI_ARGS=(task create --prompt "$PROMPT" --duration "$DURATION" --ratio "$RATIO")
  if [[ -n "${MATERIALS:-}" ]]; then
    CLI_ARGS+=(--materials "$MATERIALS")
  fi
  if [[ -n "${MODEL:-}" ]]; then
    CLI_ARGS+=(--model "$MODEL")
  fi

  # Create task (synchronous in IronLabs — returns immediately with result)
  TASK_JSON=$($CLI "${CLI_ARGS[@]}" 2>/dev/null) || {
    echo "[FAILED] $SHOT_ID — CLI error"
    FAILED=$((FAILED + 1))
    RESULTS+=("$SHOT_ID|FAILED|—|cli error")
    echo ""
    echo "Stopping batch — fix the issue and re-run."
    break
  }

  TASK_ID=$(echo "$TASK_JSON" | jq -r '.task.id // empty' 2>/dev/null)
  if [[ -z "$TASK_ID" ]]; then
    echo "[FAILED] $SHOT_ID — No task ID in response"
    FAILED=$((FAILED + 1))
    RESULTS+=("$SHOT_ID|FAILED|—|no task id")
    echo ""
    echo "Stopping batch — fix the issue and re-run."
    break
  fi

  # Get result (task is already done — just reads from local cache)
  RESULT_JSON=$($CLI task result "$TASK_ID" 2>/dev/null) || {
    echo "[FAILED] $SHOT_ID — Could not get result"
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

for entry in "${RESULTS[@]}"; do
  IFS='|' read -r shot status task_id url <<< "$entry"
  printf "%-8s %-10s %-14s %s\n" "$shot" "$status" "$task_id" "$url"
done

echo ""
echo "Total: ${#RESULTS[@]}/$SHOT_COUNT completed, $FAILED failed"

if [[ $FAILED -gt 0 ]]; then
  exit 1
fi
