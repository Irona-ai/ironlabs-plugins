---
name: ironlabs-gen
description: >
  AI video and image generation via IronLabs OpenRouter MCP connector.
  Backend: POST /api/v1/ext/token → POST /api/v1/mcp/openrouter (image_generate /
  video_submit / video_status tools).
  Uses ironlabs-cli.mjs — same CLI interface as the IronLabs plugin.
  This is the tool layer — for creative direction (story, prompts, anchoring),
  use the director skill.
  Use when user asks to "generate video", "create video", "text to video",
  "image to video", "generate image", "AI video", "AI image", "product design sheet",
  "scene background", "material pool", "ingest materials".
allowed-tools: Bash, Read, Write, Glob
metadata:
  author: ironlabs
  version: 0.3.0
  category: video-production
  tags: [video-generation, image-generation, openrouter, material-pool]
---

# IronLabs Video/Image Gen — Tool Reference

Video and image generation via IronLabs OpenRouter connector. This skill covers **how to use the tools**.
For creative decisions (story, prompts, anchoring strategy), see the **director** skill.

**Backend**: `POST /api/v1/ext/token` → `POST /api/v1/mcp/openrouter` (`image_generate`, `video_submit`, `video_status` tools)
Uses `ironlabs-cli.mjs` — same CLI interface as the IronLabs plugin, adapted for IronLabs.

**Auth**: `IRONLABS_API_KEY`. Get one at https://studio.ironlabs.ai → API Keys.
The **OpenRouter** external connector must be connected in IronLabs (**Settings → Connectors → OpenRouter**).
Visual analysis (material-ingest) shells out to `visual-analysis`'s script, which runs natively via Irona's LLM gateway — no OpenRouter connector or additional setup needed.

---

## Quick Start

```bash
# Text-to-Video — 15s (recommended default segment length)
node ${CLAUDE_SKILL_DIR}/ironlabs-cli.mjs task generate \
  --prompt "[0-5s] Close-up of a cat on the moon, slow push in. [5-15s] The cat dances under twinkling stars." \
  --duration 15 --ratio 16:9

# Image-to-Video — upload a reference image, then generate
MAT=$(node ${CLAUDE_SKILL_DIR}/ironlabs-cli.mjs material upload /path/to/photo.jpg | jq -r '.material.id')
node ${CLAUDE_SKILL_DIR}/ironlabs-cli.mjs task generate \
  --prompt "The product rotates slowly on a white pedestal, soft studio lighting, cinematic." \
  --materials "${MAT}:ref_image" --duration 15 --ratio 16:9

# Generate Image
node ${CLAUDE_SKILL_DIR}/ironlabs-cli.mjs task generate \
  --prompt "A cute cat sitting on a crescent moon, watercolor style, dreamy atmosphere" \
  --model google/gemini-3.1-flash-image-preview --ratio 1:1
```

## Supported Models

Real OpenRouter model ids — there is no alias layer. A bare slug is accepted and
expanded (`seedance-2.0` → `bytedance/seedance-2.0`); anything else is rejected
with an error rather than silently falling back to a default.

| Model | Type | Notes |
|-------|------|-------|
| `x-ai/grok-imagine-video` | Video | Default video |
| `kwaivgi/kling-v3.0-pro` | Video | Fast video |
| `bytedance/seedance-2.0` | Video | Highest ref-image capacity |
| `alibaba/happyhorse-1.1` | Video | Alt video model |
| `google/gemini-3.1-flash-image-preview` | Image | Default image |
| *(any other `provider/model` path)* | — | Advanced: passed through to the connector as-is |

Per-model capability rules — aspect ratios, duration bounds, resolutions,
whether a `last_frame` is accepted, how many `ref_image` references are used —
are enforced by the connector server-side, not by this CLI. An unsupported
combination comes back as a clear error from the server instead of being
silently dropped locally.

---

## CLI Commands

### Video Generation

```bash
node ${CLAUDE_SKILL_DIR}/ironlabs-cli.mjs task generate \
  --prompt "..." --duration 15 --ratio 16:9 \
  [--materials "<mat-id:role,...>"] [--model <model>] [--tags "project-x"]
```

**Parameters:**

| Parameter | Description | Default |
|-----------|-------------|---------|
| `--prompt` | **(required)** English narrative prompt | — |
| `--duration` | Video duration 5–15s. Omit and the API applies its own default (5s) — always pass explicitly; the recommended segment length is 15s | `5` (API default if omitted) |
| `--ratio` | Aspect ratio: 16:9, 9:16, 1:1, 4:3, 3:4 | `1:1` |
| `--materials` | Comma-separated `<mat-id:role>` pairs | — |
| `--model` | OpenRouter model id (bare slug accepted) | `x-ai/grok-imagine-video` |
| `--tags` | Project tags | — |

### Image Generation

```bash
node ${CLAUDE_SKILL_DIR}/ironlabs-cli.mjs task generate \
  --prompt "..." --model google/gemini-3.1-flash-image-preview --ratio 16:9
```

**`--seed` (images):** the connector caches on the exact request, so passing the
same `--seed` replays the previously generated image at no extra generation cost.
Omit it for a fresh random result. When generating a batch, pass sequential seeds
(`0`, `1`, `2`, ...) and reuse the same seed for the same slot on a re-run.

```bash
node ${CLAUDE_SKILL_DIR}/ironlabs-cli.mjs task generate \
  --prompt "hero product shot on white" \
  --model google/gemini-3.1-flash-image-preview --ratio 16:9 --seed 0
```

---

## Material Roles

First upload a file to get a material ID, then reference it by ID.

| Role | `--materials` syntax | What it does |
|------|---------------------|--------------|
| Reference image | `<id>:ref_image` | Style/environment guidance |
| First frame | `<id>:first_frame` | Pin opening composition |

```bash
# Upload material first
MAT=$(node ${CLAUDE_SKILL_DIR}/ironlabs-cli.mjs material upload scene.jpg | jq -r '.material.id')

# With reference image
node ${CLAUDE_SKILL_DIR}/ironlabs-cli.mjs task generate \
  --prompt "..." --duration 15 --ratio 16:9 \
  --materials "${MAT}:ref_image"

# With multiple references
MAT1=$(node ${CLAUDE_SKILL_DIR}/ironlabs-cli.mjs material upload char.jpg | jq -r '.material.id')
MAT2=$(node ${CLAUDE_SKILL_DIR}/ironlabs-cli.mjs material upload scene.jpg | jq -r '.material.id')
node ${CLAUDE_SKILL_DIR}/ironlabs-cli.mjs task generate \
  --prompt "..." --duration 15 --ratio 16:9 \
  --materials "${MAT1}:ref_image,${MAT2}:ref_image"
```

---

## Material Pool (Batch Ingest)

Scan a folder, analyze with visual analysis (native via Irona's LLM gateway — no OpenRouter connector), output `material-pool.json`:

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
| OpenRouter connector error | OpenRouter not connected | Connect at **Settings → Connectors → OpenRouter** |
| Material not found | Invalid material ID | Run `ironlabs material upload <file>` first |
| Timeout | Large video generation | Response may take 2-5 min; retry if needed |

---

## References

- [Video Model Capabilities](${CLAUDE_SKILL_DIR}/references/video-capabilities.md) — Model specs, camera movement reliability, style keywords
- [API Endpoint Reference](${CLAUDE_SKILL_DIR}/references/api-endpoints.md) — Raw API endpoints and request/response formats
