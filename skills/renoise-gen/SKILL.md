---
name: renoise-gen
description: >
  AI video and image generation via IronLabs FAL MCP connector.
  Backend: POST /api/v1/ext/token → POST /api/v1/mcp/fal (fal_run tool).
  Uses renoise-cli.mjs — same CLI interface as the Renoise plugin.
  This is the tool layer — for creative direction (story, prompts, anchoring),
  use the director skill.
  Use when user asks to "generate video", "create video", "text to video",
  "image to video", "generate image", "AI video", "AI image", "product design sheet",
  "scene background", "material pool", "ingest materials".
allowed-tools: Bash, Read, Write, Glob
metadata:
  author: ironlabs
  version: 0.1.0
  category: video-production
  tags: [video-generation, image-generation, fal, material-pool]
---

# IronLabs Video/Image Gen — Tool Reference

Video and image generation via IronLabs FAL connector. This skill covers **how to use the tools**.
For creative decisions (story, prompts, anchoring strategy), see the **director** skill.

**Backend**: `POST /api/v1/ext/token` → `POST /api/v1/mcp/fal` (fal_run tool)
Uses `renoise-cli.mjs` — same CLI interface as the Renoise plugin, adapted for IronLabs.

**Auth**: `IRONLABS_API_KEY`. Get one at https://studio.ironlabs.ai → API Keys.
The **Fal AI** external connector must be connected in IronLabs (**Settings → Connectors → Fal AI**).
Gemini analysis (material-ingest) uses Irona's LLM gateway directly — no additional connector needed.

---

## Quick Start

```bash
# Text-to-Video — 10s
node ${CLAUDE_SKILL_DIR}/renoise-cli.mjs task generate \
  --prompt "[0-5s] Close-up of a cat on the moon, slow push in. [5-10s] The cat dances under twinkling stars." \
  --duration 10 --ratio 16:9

# Image-to-Video — upload a reference image, then generate
MAT=$(node ${CLAUDE_SKILL_DIR}/renoise-cli.mjs material upload /path/to/photo.jpg | jq -r '.material.id')
node ${CLAUDE_SKILL_DIR}/renoise-cli.mjs task generate \
  --prompt "The product rotates slowly on a white pedestal, soft studio lighting, cinematic." \
  --materials "${MAT}:ref_image" --duration 10 --ratio 16:9

# Generate Image
node ${CLAUDE_SKILL_DIR}/renoise-cli.mjs task generate \
  --prompt "A cute cat sitting on a crescent moon, watercolor style, dreamy atmosphere" \
  --model nano-banana-2 --ratio 1:1
```

## Supported Models

| Model alias | FAL model | Type | Notes |
|-------------|-----------|------|-------|
| `renoise-2.0` | `fal-ai/minimax/video-01` | Video | Default video |
| `renoise-2.0-fast` | `fal-ai/minimax/video-01-lite` | Video | Fast video |
| `nano-banana-2` | `fal-ai/flux/dev` | Image | Default image |
| `nano-banana-pro` | `fal-ai/flux-pro/v1.1` | Image | High fidelity |
| `midjourney-v7` | `fal-ai/ideogram/v2` | Image | Artistic |
| `gpt-image-2` | `fal-ai/gpt-image-1` | Image | GPT-based |
| *(any `fal-ai/...` path)* | — | — | Pass FAL model directly |

---

## CLI Commands

### Video Generation

```bash
node ${CLAUDE_SKILL_DIR}/renoise-cli.mjs task generate \
  --prompt "..." --duration 10 --ratio 16:9 \
  [--materials "<mat-id:role,...>"] [--model <model>] [--tags "project-x"]
```

**Parameters:**

| Parameter | Description | Default |
|-----------|-------------|---------|
| `--prompt` | **(required)** English narrative prompt | — |
| `--duration` | Video duration 5–10s | `5` |
| `--ratio` | Aspect ratio: 16:9, 9:16, 1:1, 4:3, 3:4 | `1:1` |
| `--materials` | Comma-separated `<mat-id:role>` pairs | — |
| `--model` | Model alias or FAL path | `renoise-2.0` |
| `--tags` | Project tags | — |

### Image Generation

```bash
node ${CLAUDE_SKILL_DIR}/renoise-cli.mjs task generate \
  --prompt "..." --model nano-banana-2 --ratio 16:9
```

---

## Material Roles

First upload a file to get a material ID, then reference it by ID.

| Role | `--materials` syntax | What it does |
|------|---------------------|--------------|
| Reference image | `<id>:ref_image` | Style/environment guidance |
| First frame | `<id>:first_frame` | Pin opening composition |
| Reference video | `<id>:ref_video` | Motion/style carryover |

```bash
# Upload material first
MAT=$(node ${CLAUDE_SKILL_DIR}/renoise-cli.mjs material upload scene.jpg | jq -r '.material.id')

# With reference image
node ${CLAUDE_SKILL_DIR}/renoise-cli.mjs task generate \
  --prompt "..." --duration 10 --ratio 16:9 \
  --materials "${MAT}:ref_image"

# With multiple references
MAT1=$(node ${CLAUDE_SKILL_DIR}/renoise-cli.mjs material upload char.jpg | jq -r '.material.id')
MAT2=$(node ${CLAUDE_SKILL_DIR}/renoise-cli.mjs material upload scene.jpg | jq -r '.material.id')
node ${CLAUDE_SKILL_DIR}/renoise-cli.mjs task generate \
  --prompt "..." --duration 10 --ratio 16:9 \
  --materials "${MAT1}:ref_image,${MAT2}:ref_image"
```

---

## Material Pool (Batch Ingest)

Scan a folder, analyze with Gemini (via OpenRouter connector), output `material-pool.json`:

```bash
node ${CLAUDE_SKILL_DIR}/scripts/material-ingest.mjs ./materials/
```

Auto-match materials to shots:

```bash
node ${CLAUDE_SKILL_DIR}/scripts/match-materials.mjs \
  --pool material-pool.json --shots project.json
```

---

## Prompt Basics

- **English only** — narrative sentences, not tag lists
- **Specific over abstract** — describe subject + action + camera + scene + style
- **Shot density** for time-annotated prompts:
  - 5s: 1 shot
  - 10s: 2–3 shots
  - 15s: 3–4 shots
  - End with "frame holds steady" for clean endings

---

## Error Handling

| Error | Cause | Fix |
|-------|-------|-----|
| 401 Unauthorized | Invalid `IRONLABS_API_KEY` | Check env var, run `/ironlabs:setup` |
| FAL connector error | FAL AI not connected | Connect at **Settings → Connectors → Fal AI** |
| Material not found | Invalid material ID | Run `ironlabs material upload <file>` first |
| Timeout | Large video generation | Response may take 2-5 min; retry if needed |

---

## References

- [Video Model Capabilities](${CLAUDE_SKILL_DIR}/references/video-capabilities.md) — Model specs, camera movement reliability, style keywords
- [API Endpoint Reference](${CLAUDE_SKILL_DIR}/references/api-endpoints.md) — Raw API endpoints and request/response formats
