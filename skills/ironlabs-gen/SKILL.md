---
name: ironlabs-gen
description: >
  AI video and image generation via the IronLabs image/video MCP connector.
  Backend: POST /api/v1/mcp/ext/generate (image_generate / video_generate tools).
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
  tags: [video-generation, image-generation, material-pool]
---

# IronLabs Video/Image Gen — Tool Reference

Video and image generation via the IronLabs image/video connector. This skill covers **how to use the tools**.
For creative decisions (story, prompts, anchoring strategy), see the **director** skill.

**Backend**: `POST /api/v1/mcp/ext/generate` (`image_generate`, `video_generate` tools) — the same
endpoint the chat app uses, so a generation here runs the same server-side chain:
**exact cache → semantic cache → MuAPI → OpenRouter fallback**. Both tools are synchronous;
each result reports which tier served it (`source`) and what it cost (`costUsd`).

**Auth**: `IRONLABS_API_KEY`. Get one at https://studio.ironlabs.ai → API Keys. That key is the only
credential needed — the connector holds the upstream provider keys server-side.
Visual analysis (material-ingest) shells out to `visual-analysis`'s script, which runs natively via Irona's LLM gateway — no additional setup needed.

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

Real model ids — there is no alias layer. A bare slug is accepted and
expanded (`seedance-2.0` → `bytedance/seedance-2.0`); anything else is rejected
with an error rather than silently falling back to a default.

| Model | Type | Notes |
|-------|------|-------|
| `bytedance/seedance-2.0` | Video | **Default video** |
| `x-ai/grok-imagine-video` | Video | Alt video model |
| `kwaivgi/kling-v3.0-pro` | Video | Fast video |
| `alibaba/happyhorse-1.1` | Video | Not on MuAPI — always billed via OpenRouter |
| `google/gemini-3.1-flash-image-preview` | Image | **Default image** (Nano Banana 2) |
| `google/gemini-3.1-flash-lite-image` | Image | Cheapest image |
| `google/gemini-3-pro-image-preview` | Image | Highest quality |
| `google/gemini-2.5-flash-image` | Image | Nano Banana 1 |
| `x-ai/grok-imagine-image-quality` | Image | Alt image model |
| `bytedance-seed/seedream-4.5` | Image | Alt image model |
| *(any other `provider/model` path)* | — | Advanced: passed through to the connector as-is |

Per-model capability rules — aspect ratios, duration bounds, resolutions, and
whether a request can be served by MuAPI or must fall through to OpenRouter —
are enforced by the connector server-side, not by this CLI. An unsupported
combination comes back as a clear error from the server instead of being
silently dropped locally.

**Caching.** Both tools key their cache on the *user's own wording*, so pass
`--user-prompt "<what the user actually asked for>"` whenever `--prompt` is your
expanded version of it — that is what lets a repeat request be served from cache
instead of regenerating. Omitting `--model` on a video additionally lets the
server check its cache under the other video models before generating.

A cache hit returns the earlier asset in a fraction of the time, but **is still
billed** — it saves latency and upstream provider cost, not your credits. Both
cache tiers are also opt-in server-side (`ENABLE_IMAGE_GENERATION_CACHE`,
`ENABLE_VIDEO_GENERATION_CACHE`, and the matching `..._SEMANTIC_CACHE` flags);
where they are off, every repeat regenerates and `source` is never `exact-cache`
or `semantic-cache`.

---

## CLI Commands

### Video Generation

```bash
node ${CLAUDE_SKILL_DIR}/ironlabs-cli.mjs task generate \
  --prompt "..." --duration 15 --ratio 16:9 \
  [--materials "<mat-id>:first_frame"] [--model <model>] [--tags "project-x"]
```

**Parameters:**

| Parameter | Description | Default |
|-----------|-------------|---------|
| `--prompt` | **(required)** English narrative prompt | — |
| `--user-prompt` | The user's own wording, when `--prompt` is your expansion of it. The cache is keyed on this | — |
| `--duration` | Video duration 5–15s. Omit and the server applies its own default (10s) — always pass explicitly; the recommended segment length is 15s | `10` (server default if omitted) |
| `--ratio` | Aspect ratio: 16:9, 9:16, 1:1, 4:3, 3:4 | `16:9` |
| `--materials` | Comma-separated `<mat-id:role>` pairs. Video uses a single still as its first frame | — |
| `--model` | Model id (bare slug accepted). Omit to also get the cross-model cache check | `bytedance/seedance-2.0` |
| `--no-audio` | Render silent. Avoid unless asked — it scopes the cache key and skips the MuAPI tier | audio on |
| `--tags` | Project tags | — |

### Image Generation

```bash
node ${CLAUDE_SKILL_DIR}/ironlabs-cli.mjs task generate \
  --prompt "..." --model google/gemini-3.1-flash-image-preview --ratio 16:9
```

Images take `--quantity <1-4>` for a batch in one call — every image is returned
(`task result` prints them all) and **every image is billed**, so `--quantity 4`
costs 4x a single render. `--resolution` does not apply — image size is controlled
by `--ratio`.

**Reusing a result:** there is no client-side seed. Repeat generations are
deduplicated by the server's cache, which keys on the request and on
`--user-prompt`, so pass the user's own wording to make a repeat ask hit it.
Note this returns the *same* image quickly rather than making it free — a cache
hit is still billed:

```bash
node ${CLAUDE_SKILL_DIR}/ironlabs-cli.mjs task generate \
  --user-prompt "give me an owl image" \
  --prompt "a great horned owl on a branch, photorealistic" \
  --model google/gemini-3.1-flash-image-preview --ratio 16:9
```

---

## Material Roles

First upload a file to get a material ID, then reference it by ID.

| Role | `--materials` syntax | What it does |
|------|---------------------|--------------|
| Reference image | `<id>:ref_image` | Style/environment guidance (the default when no role is given; `reference_image` is an accepted alias) |
| First frame | `<id>:first_frame` | Pin opening composition |

Registered assets use `asset:<id>:<role>`; registered characters use the separate
`--characters "<id>:ref_image"` flag. Uploads are stored locally and embedded as
inline `data:` URIs — there is no hosting endpoint, so downscale large stills to
keep generate calls fast.

```bash
# Upload material first
MAT=$(node ${CLAUDE_SKILL_DIR}/ironlabs-cli.mjs material upload scene.jpg | jq -r '.material.id')

# With reference image
node ${CLAUDE_SKILL_DIR}/ironlabs-cli.mjs task generate \
  --prompt "..." --duration 15 --ratio 16:9 \
  --materials "${MAT}:ref_image"

# Pin the opening frame instead (e.g. a tail frame carried over from the last shot)
node ${CLAUDE_SKILL_DIR}/ironlabs-cli.mjs task generate \
  --prompt "..." --duration 15 --ratio 16:9 \
  --materials "${MAT}:first_frame"
```

> **Video takes one still, not several.** `video_generate` has a single `image_url`
> argument — passing two or more `ref_image` materials sends the first and warns
> that the rest were ignored. To combine references (character + location, say),
> compose them into one image with `image_generate` first, then pass that composite.
> Image generation likewise takes a single reference.

---

## Material Pool (Batch Ingest)

Scan a folder, analyze with visual analysis (native via Irona's LLM gateway — no generation connector), output `material-pool.json`:

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
| Image/Video connector error | Connector turned off, or no Pro/credits | Enable at **Settings → Connectors**; check `ironlabs credit me` |
| Material not found | Invalid material ID | Run `ironlabs material upload <file>` first |
| Stream closed without a result | The render outran the server's request budget | Retry with a shorter `--duration`; the job may already have been billed |

---

## References

- [Video Model Capabilities](${CLAUDE_SKILL_DIR}/references/video-capabilities.md) — Model specs, camera movement reliability, style keywords
- [API Endpoint Reference](${CLAUDE_SKILL_DIR}/references/api-endpoints.md) — Raw API endpoints and request/response formats
