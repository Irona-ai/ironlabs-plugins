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
  version: 0.2.1
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

**MuAPI-first for video**: video generation tries the **MuAPI** connector first, falling back to OpenRouter automatically on any submit failure (for models that have an OpenRouter equivalent — see below). This is transparent — no flag needed. It only applies to plain text-to-video / single-first-frame image-to-video (no `last_image_url` interpolation or multi-reference support on MuAPI yet, so those requests skip straight to OpenRouter).

MuAPI is attempted for the resolved model only when it appears in `MUAPI_MODEL_ID` (`ironlabs-cli.mjs`):

| Alias | Resolved model | MuAPI `model` value | Status |
|---|---|---|---|
| `youmeng-2.0` / `seedance-2.0` / `sd-2.0` | `bytedance/seedance-2.0` | *(omitted — this is MuAPI's implicit default, and the one call shape confirmed working)* | **Confirmed** working against the live connector |
| `ironlabs-2.0` (default) | `x-ai/grok-imagine-video` | `grok-imagine-video` | ⚠️ **UNVERIFIED** — best-guess slug, not confirmed against the live IronLabs `/mcp/muapi` connector |
| `ironlabs-2.0-fast` | `kwaivgi/kling-v3.0-pro` | `kling-v3.0-pro` | ⚠️ **UNVERIFIED** — same caveat |
| `happyhorse-1.1` | *(MuAPI-only, no OpenRouter equivalent)* | `happyhorse-1.1` | ⚠️ **UNVERIFIED**, and has **no fallback** — a submit failure is a hard error, not a graceful degrade |

The `model` field is deliberately omitted for `bytedance/seedance-2.0` rather than sent as `"seedance-2.0"` — that no-`model` call shape is the one confirmed working against the live connector, and sending an untested field risks regressing it if the schema rejects unrecognized properties. It's only included for the unverified entries, where it's required to have any chance of hitting the right backend.

**Why "unverified" is safe to ship for the OR-backed models but risky in principle**: `canTryMuapiVideo()`'s caller falls back to OpenRouter automatically on any 4xx submit failure, so if MuAPI rejects an unrecognized `model` value, generation still succeeds via OpenRouter with the correct model — no user-visible breakage. The theoretical risk is the connector *accepting* a wrong/unrecognized `model` value and silently rendering on a different backend than requested (this exact failure mode is why the seedance-2.0-only version of this gate existed before). `happyhorse-1.1` has no such safety net since it has no OpenRouter fallback path at all.

**To confirm and remove the UNVERIFIED caveat**, whoever owns the IronLabs `/mcp/muapi` backend connector needs to confirm:
1. Does `video_submit` accept a `model` argument today, and if so what identifier format does it expect (MuAPI's own playground slugs — `grok-imagine-text-to-video`, `kling-v3.0-pro-text-to-video`, `happyhorse-1.1` — or something IronLabs-specific)?
2. Does the connector reject an unrecognized `model` value with a 4xx (safe — falls back automatically), or does it silently default to `seedance-2.0` regardless (unsafe — reproduces the original bug)?
3. Is `happyhorse-1.1` proxied at all, given IronLabs has no OpenRouter route for it as a fallback?

Once confirmed, update `MUAPI_MODEL_ID` / `MUAPI_ONLY_VIDEO_MODEL_MAP` in `ironlabs-cli.mjs` with the verified identifiers and drop the UNVERIFIED comments.

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
  --model nano-banana-2 --ratio 1:1
```

## Supported Models

| Model alias | Resolves to (implementation detail — may change) | Type | Notes |
|-------------|-------------------|------|-------|
| `ironlabs-2.0` | `x-ai/grok-imagine-video` | Video | Default video |
| `ironlabs-2.0-fast` | `kwaivgi/kling-v3.0-pro` | Video | Fast video |
| `youmeng-2.0` / `seedance-2.0` / `sd-2.0` | `bytedance/seedance-2.0` | Video | Alt video model |
| `nano-banana-2` | `google/gemini-3.1-flash-image-preview` | Image | Default image |
| `nano-banana-pro` | `google/gemini-3.1-flash-image-preview` | Image | Currently maps to the same model as `nano-banana-2` |
| `midjourney-v7` | `google/gemini-3.1-flash-image-preview` | Image | Artistic |
| `gpt-image-2` | `google/gemini-3.1-flash-image-preview` | Image | GPT-based |
| *(any `provider/model` path)* | — | — | Advanced: pass a raw provider/model path directly, bypassing the alias |

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
| `--model` | Model alias or OpenRouter path | `ironlabs-2.0` |
| `--tags` | Project tags | — |

### Image Generation

```bash
node ${CLAUDE_SKILL_DIR}/ironlabs-cli.mjs task generate \
  --prompt "..." --model nano-banana-2 --ratio 16:9
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
