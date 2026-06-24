---
name: gemini-gen
description: >
  Visual understanding and multimodal analysis via Irona's LLM gateway
  (gemini-2.5-flash — no OpenRouter connector required). Handles product analysis,
  video script extraction, and style analysis from images and videos.
  Backend: POST /api/v1/chat/completions (SSE).
  Do NOT use for generating images or videos — use renoise-gen for that.
allowed-tools: Bash, Read
metadata:
  author: ironlabs
  version: 0.3.0
  category: video-production
  tags: [gemini, vision, multimodal, analysis]
---

# Gemini Gen — Visual Understanding & Multimodal Analysis

Gemini 2.5 Flash via Irona's LLM gateway. Zero npm dependencies, native `fetch` only.
Handles images and videos (≤20MB inline). Files > 20MB: extract frames first.

**Auth**: `IRONLABS_API_KEY`. Get one at https://studio.ironlabs.ai → API Keys.

## Image Input: Two Modes

### Mode 1 — File path (runs the script)
When the user provides a local file path, run the script directly:
```bash
node ${CLAUDE_SKILL_DIR}/scripts/gemini.mjs --file /path/to/image.jpg --mode product
```

### Mode 2 — Pasted image (use your own vision)
When the user pastes an image inline in the chat **without a file path**, the image arrives
as inline conversation data — you can see it, but the script cannot access the bytes.
In this case, **analyze the image directly using your own vision** and format the output
exactly as the relevant mode preset would (e.g. JSON for `product`/`style`, timestamped
text for `video-script`). Do NOT ask the user to save the file first.

## Quick Start

```bash
# Analyze a product photo from a file
node ${CLAUDE_SKILL_DIR}/scripts/gemini.mjs --file photo.jpg --mode product

# Analyze from a base64 data URI (programmatic / script-to-script use)
node ${CLAUDE_SKILL_DIR}/scripts/gemini.mjs --data-uri "data:image/jpeg;base64,..." --mode product

# Extract a video script with timestamps
node ${CLAUDE_SKILL_DIR}/scripts/gemini.mjs --file clip.mp4 --mode video-script

# Extract visual style keywords from a reference
node ${CLAUDE_SKILL_DIR}/scripts/gemini.mjs --file reference.jpg --mode style

# Free-form analysis
node ${CLAUDE_SKILL_DIR}/scripts/gemini.mjs --file photo.jpg "Describe this image in detail"
```

## Analysis Modes

### Product Analysis (`--mode product`)

Returns structured JSON with type, color, material, selling points, brand tone, and scene suggestions.

```bash
node ${CLAUDE_SKILL_DIR}/scripts/gemini.mjs --file product.jpg --mode product
```

Output:
```json
{
  "type": "resistance loop bands",
  "color": "Pink 10lb, Blue 15lb, Mint green 20lb",
  "material": "TPE elastic, matte finish",
  "selling_points": ["3 resistance levels", "foldable and portable", "pastel color scheme"],
  "brand_tone": "Youthful athletic, trendy fitness",
  "scene_suggestions": ["living room workout", "hotel room fitness", "outdoor park"]
}
```

### Video Script Extraction (`--mode video-script`)

Watches a video and outputs timestamped dialogue, scene descriptions, and camera movements.

```bash
node ${CLAUDE_SKILL_DIR}/scripts/gemini.mjs --file clip.mp4 --mode video-script
```

### Style Extraction (`--mode style`)

Extracts color palette, lighting, camera language, composition, and mood.

```bash
node ${CLAUDE_SKILL_DIR}/scripts/gemini.mjs --file reference.jpg --mode style
```

## CLI Usage

```bash
# Text only
node ${CLAUDE_SKILL_DIR}/scripts/gemini.mjs "Explain quantum computing"

# Analyze an image from a file
node ${CLAUDE_SKILL_DIR}/scripts/gemini.mjs --file photo.jpg "Describe this product"

# Analyze an image from an inline base64 data URI (e.g. pasted in chat)
node ${CLAUDE_SKILL_DIR}/scripts/gemini.mjs --data-uri "data:image/jpeg;base64,..." --mode product

# Multiple images
node ${CLAUDE_SKILL_DIR}/scripts/gemini.mjs --file a.jpg --file b.jpg "Compare these two"

# JSON output mode
node ${CLAUDE_SKILL_DIR}/scripts/gemini.mjs --json "Return a JSON object with name and age"
```

### Options

| Flag                   | Default                    | Description                                     |
| ---------------------- | -------------------------- | ----------------------------------------------- |
| `--file <path>`        | —                          | Attach local file (repeatable, ≤20MB inline)    |
| `--data-uri <uri>`     | —                          | Inline base64 data URI (repeatable, for pasted images) |
| `--resolution <level>` | `medium`                   | Hint only: `low` / `medium` / `high` / `ultra_high` |
| `--model <name>`       | `gemini-2.5-flash`         | Irona model name                                |
| `--temperature <n>`    | `1.0`                      | Temperature                                     |
| `--max-tokens <n>`     | `8192`                     | Max output tokens                               |
| `--json`               | off                        | Append JSON-only instruction to prompt          |
| `--mode <name>`        | —                          | Preset: `product`, `video-script`, `style`      |

## Large File Handling

Files ≤20MB are sent inline as base64. For files >20MB (e.g., long videos):
1. Extract key frames: `ffmpeg -i video.mp4 -vf "fps=1" frame_%04d.jpg`
2. Analyze individual frames: `node gemini.mjs --file frame_0001.jpg --mode style`

## When to Use vs When Not

| Use gemini-gen for | Use renoise-gen for |
|---|---|
| Analyzing product photos | Generating images |
| Understanding video content | Generating videos |
| Extracting scripts from video | Text-to-video / image-to-video |
| Comparing visual assets | Product design sheets |
| OCR / text extraction | Scene backgrounds |
| Describing scenes for prompts | — |

## Authentication

Environment variable `IRONLABS_API_KEY`. Get one at: https://studio.ironlabs.ai → API Keys.
No external connectors required — Gemini routes through Irona's LLM gateway directly.
