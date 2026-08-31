#!/usr/bin/env bash
# download-video.sh — Download video to resources/references/ with dedup and platform detection
#
# Usage:
#   download-video.sh <URL> [output_dir]
#
# Features:
#   - Extracts platform-prefixed video ID (yt-xxx, tk-xxx, vid-xxx)
#   - Skips download if file already exists (dedup)
#   - Auto-retries TikTok with --cookies-from-browser chrome on 403
#   - Outputs final file path on success

set -euo pipefail

URL="${1:?Usage: download-video.sh <URL> [output_dir]}"
OUTPUT_DIR="${2:-resources/references}"

# --- Video ID extraction ---

extract_video_id() {
  local url="$1"

  # YouTube: watch?v=, shorts/, embed/, youtu.be/
  if [[ "$url" =~ (youtube\.com/(watch\?v=|shorts/|embed/)|youtu\.be/)([\w-]{11}|[A-Za-z0-9_-]{11}) ]]; then
    local yt_id
    yt_id=$(echo "$url" | grep -oE '(watch\?v=|shorts/|embed/|youtu\.be/)([A-Za-z0-9_-]{11})' | grep -oE '[A-Za-z0-9_-]{11}$')
    echo "yt-${yt_id}"
    return
  fi

  # TikTok: numeric ID (15+ digits). Short links (vm.tiktok.com/ZMxxxx) carry
  # no numeric ID, so key them on their slug instead of falling through.
  if [[ "$url" =~ tiktok\.com ]]; then
    local tk_id
    tk_id=$(echo "$url" | grep -oE '[0-9]{15,}' | head -1)
    if [[ -n "$tk_id" ]]; then
      echo "tk-${tk_id}"
      return
    fi
    local tk_slug
    tk_slug=$(echo "$url" | grep -oE 'tiktok\.com/[A-Za-z0-9]+' | head -1 | cut -d/ -f2)
    if [[ -n "$tk_slug" ]]; then
      echo "tk-${tk_slug}"
      return
    fi
  fi

  # Fallback: md5 of the full URL, first 16 hex chars.
  # Must hash the whole URL — truncating an encoding of it collides, since
  # base64's first 16 chars only cover the first 12 bytes ("https://www.").
  local hash
  if command -v md5 >/dev/null 2>&1; then
    hash=$(printf '%s' "$url" | md5 -q | head -c 16)
  else
    hash=$(printf '%s' "$url" | md5sum | cut -d' ' -f1 | head -c 16)
  fi
  echo "vid-${hash}"
}

VIDEO_ID=$(extract_video_id "$URL")
OUTPUT="${OUTPUT_DIR}/${VIDEO_ID}.mp4"

# --- Dedup check ---

if [[ -f "$OUTPUT" && $(stat -f%z "$OUTPUT" 2>/dev/null || stat -c%s "$OUTPUT" 2>/dev/null) -gt 0 ]]; then
  echo "ALREADY_EXISTS: $OUTPUT"
  exit 0
fi

# Remove zero-byte leftover from interrupted download
[[ -f "$OUTPUT" ]] && rm -f "$OUTPUT"

mkdir -p "$OUTPUT_DIR"

# --- Download ---

YT_DLP_ARGS=(
  -f 'bestvideo[ext=mp4]+bestaudio[ext=m4a]/best[ext=mp4]/best'
  --merge-output-format mp4
  --no-playlist
  --max-filesize 200M
  -o "$OUTPUT"
)

echo "Downloading: $URL"
echo "Output: $OUTPUT"

if yt-dlp "${YT_DLP_ARGS[@]}" "$URL"; then
  echo "DOWNLOADED: $OUTPUT"
  exit 0
fi

# --- TikTok 403 retry with cookies ---

if [[ "$URL" =~ tiktok\.com ]]; then
  echo "Retrying TikTok with browser cookies..."
  if yt-dlp "${YT_DLP_ARGS[@]}" --cookies-from-browser chrome "$URL"; then
    echo "DOWNLOADED: $OUTPUT"
    exit 0
  fi
fi

echo "FAILED: Could not download $URL"
exit 1
