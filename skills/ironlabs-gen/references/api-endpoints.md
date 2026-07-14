# IronLabs API Reference

## Base URL & Auth

```
Base URL: https://www.chat.ironlabs.ai/api/v1   (or IRONLABS_BASE_URL if set)
Auth:     Authorization: Bearer <IRONLABS_API_KEY>
```

All generation goes through the **MCP connector system**. Two steps:
1. Issue a sandbox token (short-lived JWT)
2. Call the MCP endpoint with that token

---

## Endpoints

### Balance

| Method | Path | Description |
|--------|------|-------------|
| GET | `/chat/balance` | Current credit balance |

Response:
```json
{ "balance": 150 }
```
Balance is in cents — divide by 100 for dollars (`$1.50`).

---

### Sandbox Token

| Method | Path | Description |
|--------|------|-------------|
| POST | `/ext/token` | Issue a short-lived sandbox token |

**Request:**
```json
{
  "scope": ["openrouter"],
  "ttlSeconds": 3600
}
```

**Response:**
```json
{
  "success": true,
  "data": {
    "token": "<jwt>",
    "expiresAt": 1234567890,
    "scope": ["openrouter"]
  }
}
```

Scope value: `"openrouter"` — used for both generation (image/video) and Gemini analysis.

---

### MCP Connector — Image Generation (OpenRouter)

| Method | Path | Description |
|--------|------|-------------|
| POST | `/mcp/openrouter` | Run `image_generate` via MCP connector |

Auth: `Authorization: Bearer <sandbox_token>` (NOT the API key — use token from `/ext/token`)

**Request — MCP JSON-RPC:**
```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "method": "tools/call",
  "params": {
    "name": "image_generate",
    "arguments": {
      "prompt": "A cute cat sitting on a crescent moon, watercolor style",
      "model": "google/gemini-3.1-flash-image-preview",
      "size": "1024x1024",
      "image_url": "data:image/jpeg;base64,<b64>"
    }
  }
}
```
`image_url` is optional — include it for image-to-image (reference/first-frame material).

**Response:** a chat-completion object; the image is in `choices[0].message.content[]` as a `{ type: "image_url", image_url: { url } }` part.

---

### MCP Connector — Video Generation (OpenRouter)

| Method | Path | Description |
|--------|------|-------------|
| POST | `/mcp/openrouter` | Run `video_submit` via MCP connector (async) |
| POST | `/mcp/openrouter` | Run `video_status` to poll a submitted generation |
| POST | `/mcp/openrouter` | Run `video_download` to fetch the finished video bytes |

**Request — submit:**
```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "method": "tools/call",
  "params": {
    "name": "video_submit",
    "arguments": {
      "prompt": "@Image1 dancing on the moon, cinematic. @Image2 visible in the background.",
      "model": "x-ai/grok-imagine-video",
      "image_url": "data:image/jpeg;base64,<b64>",
      "last_image_url": "data:image/jpeg;base64,<b64>",
      "reference_image_urls": ["data:image/jpeg;base64,<b64_1>", "data:image/jpeg;base64,<b64_2>"],
      "duration": 5,
      "aspect_ratio": "16:9",
      "resolution": "720p"
    }
  }
}
```
`image_url` (first frame) is optional — omit it for pure text-to-video. Include it for image-to-video (first-frame/ref_image material).
`last_image_url` is optional, but **model-gated**: irona-chat's `video_submit` now checks `supportsLastFrame` per model before forwarding it — `x-ai/grok-imagine-video` (the default) doesn't support it and the connector throws a clear error rather than silently sending an invalid combination to OpenRouter. `kwaivgi/kling-v3.0-pro` and `bytedance/seedance-2.0` do support it.
`reference_image_urls` — **confirmed working, not speculative.** Maps to OpenRouter's real `input_references` field (documented at [openrouter.ai/docs/api-reference/video-generation/create-videos](https://openrouter.ai/docs/api/api-reference/video-generation/create-videos)), capped per-model server-side via `maxInputReferences`. `ironlabs-cli.mjs` sends every attached `ref_image` material here, in upload order — bind to each with `@Image1`, `@Image2`, ... in the prompt.
Response: `{ id, polling_url, status }`.

**Still no `video_url` field.** `video_submit` has no way to accept an existing video as input — that capability doesn't exist on OpenRouter's video API at all (checked OpenRouter's own docs directly: text-to-video, image-to-video, and reference-to-video are the only three modes it documents, for any model, including Veo 3.1 which is otherwise available through OpenRouter). See the Fal Direct section below for how real video-to-video continuation works instead.

**Request — poll status:**
```json
{ "params": { "name": "video_status", "arguments": { "id": "<generation-id>" } } }
```
Poll every ~10s until `status` is `"completed"` (result in `unsigned_urls[0]`) or `"failed"`.

**Request — download (video URLs need gateway auth):**
```json
{ "params": { "name": "video_download", "arguments": { "url": "<video-url>" } } }
```
Response: `{ data_base64: "<base64 video bytes>" }`.

---

### MCP Connector — Fal Direct (multi-reference & video-to-video)

| Method | Path | Description |
|--------|------|-------------|
| POST | `/mcp/fal` | Run `fal_run` — synchronous passthrough to `https://fal.run/{model}` |

`fal_run` takes `{ model, input }` and forwards `input` verbatim as the POST body to `https://fal.run/{model}` — no schema translation, so it can reach capabilities OpenRouter's `video_submit` doesn't expose. Confirmed against fal.ai's own published API schemas (input **and** output):

**Multi-reference (`@Image1`/`@Image2` binding)** — model `xai/grok-imagine-video/reference-to-video`:
```json
{
  "params": {
    "name": "fal_run",
    "arguments": {
      "model": "xai/grok-imagine-video/reference-to-video",
      "input": {
        "prompt": "@Image1 running through a sunlit meadow, @Image2 visible in the background",
        "reference_image_urls": ["<url or data-uri 1>", "<url or data-uri 2>"],
        "duration": 8,
        "resolution": "480p",
        "aspect_ratio": "16:9"
      }
    }
  }
}
```
`reference_image_urls`: 1–7 images, required. `@Image1`, `@Image2`, ... in `prompt` bind to array order — this is genuinely documented by fal.ai, not speculative. Response: `{ "video": { "url": "...", "duration", "width", "height", "fps", "content_type" } }`.

**True video-to-video continuation** — model `fal-ai/veo3.1/extend-video` (or `fal-ai/veo3.1/fast/extend-video`):
```json
{
  "params": {
    "name": "fal_run",
    "arguments": {
      "model": "fal-ai/veo3.1/extend-video",
      "input": {
        "prompt": "Continue the scene naturally, same motion and style",
        "video_url": "<url or data-uri of the prior clip>",
        "duration": "7s",
        "resolution": "720p",
        "aspect_ratio": "16:9"
      }
    }
  }
}
```
`video_url` (required) is the actual source clip — this is the only model in this reference that accepts video input at all. Adds up to 7s per call, chainable toward ~30-148s total depending on tier. Response: `{ "video": { "url": "..." } }`.

Both calls are **synchronous** — the response is the finished result, not a job id. No `video_status`/`video_download` polling step for these two.

`x-ai/grok-imagine-video` (the OpenRouter default, `ironlabs-2.0`) has **no** video-input capability anywhere — not via OpenRouter, not via its own fal.ai-hosted endpoint. `ref_video` only works with the two `veo-3.1-extend*` models above; there is no way to make it work with the default model.

---

### MCP Connector — Gemini Analysis (OpenRouter)

| Method | Path | Description |
|--------|------|-------------|
| POST | `/mcp/openrouter` | Run OpenRouter model via MCP connector |

**Request:**
```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "method": "tools/call",
  "params": {
    "name": "openrouter_chat_completion",
    "arguments": {
      "model": "google/gemini-2.5-flash",
      "messages": [{
        "role": "user",
        "content": [
          { "type": "image_url", "image_url": { "url": "data:image/jpeg;base64,<b64>" } },
          { "type": "text", "text": "Analyze this product photo." }
        ]
      }],
      "max_tokens": 8192,
      "temperature": 1.0
    }
  }
}
```

---

## Model Aliases (ironlabs-cli.mjs)

| Alias | Model | Backend | Type |
|-------|-------|---------|------|
| `ironlabs-2.0` | `x-ai/grok-imagine-video` | OpenRouter (async) | Video (default) |
| `ironlabs-2.0-fast` | `kwaivgi/kling-v3.0-pro` | OpenRouter (async) | Video fast |
| `youmeng-2.0` / `seedance-2.0` / `sd-2.0` | `bytedance/seedance-2.0` | OpenRouter (async) | Video alt |
| `nano-banana-2` | `google/gemini-3.1-flash-image-preview` | OpenRouter (sync) | Image (default) |
| `nano-banana-pro` | `google/gemini-3.1-flash-image-preview` | OpenRouter (sync) | Image (currently same model as `nano-banana-2`) |
| `midjourney-v7` | `google/gemini-3.1-flash-image-preview` | OpenRouter (sync) | Image artistic |
| `gpt-image-2` | `google/gemini-3.1-flash-image-preview` | OpenRouter (sync) | Image GPT-based |
| `grok-multiref` | `xai/grok-imagine-video/reference-to-video` | fal direct (sync) | Video, 1-7 `ref_image` materials, `@ImageN` binding — same capability `ironlabs-2.0` now also has via OpenRouter; use this only if you specifically want the fal-direct synchronous call |
| `veo-3.1-extend` | `fal-ai/veo3.1/extend-video` | fal direct (sync) | Video-to-video continuation, 1 `ref_video` material — no OpenRouter equivalent exists |
| `veo-3.1-extend-fast` | `fal-ai/veo3.1/fast/extend-video` | fal direct (sync) | Same, faster/cheaper tier |

Pass any `provider/model` path directly to skip aliasing (not applicable to the three fal-direct aliases, which aren't OpenRouter paths).

## Material Roles

| Role | Works with | Sent as | Description |
|------|-----------|---------|--------------|
| `first_frame` | any OpenRouter video model | `image_url` | Pin opening frame |
| `last_frame` | OpenRouter models with `supportsLastFrame` | `last_image_url` | Pin closing frame. `x-ai/grok-imagine-video` (default) does NOT support this — the connector throws rather than silently accepting it. `kwaivgi/kling-v3.0-pro`/`bytedance/seedance-2.0` do. |
| `ref_image` (1+) | any OpenRouter video model, `grok-multiref`, or image models | `image_url` (first one) + `reference_image_urls` (all of them) | Style/identity reference. Bind each to `@Image1`, `@Image2`, ... in the prompt, in upload order — confirmed real on OpenRouter now (maps to its documented `input_references` field), capped per-model server-side. |
| `ref_video` | **`veo-3.1-extend` / `veo-3.1-extend-fast` only** | `video_url` | True motion/style carryover from a completed clip. No OpenRouter model — including Veo 3.1, which IS otherwise available through OpenRouter — exposes this; OpenRouter's video API has no video-to-video mode at all, confirmed from OpenRouter's own docs. Passing `ref_video` to any OpenRouter model here is a hard error, not a silent no-op. |

Materials are stored locally in `~/.ironlabs/materials/` as base64 by `ironlabs-cli.mjs`.

## Aspect Ratios

`16:9`, `9:16`, `1:1`, `4:3`, `3:4`

## Image Size Mapping (OpenRouter `image_generate`)

| CLI ratio | `size` |
|-----------|--------|
| `1:1` | `1024x1024` |
| `16:9` | `1536x1024` |
| `9:16` | `1024x1536` |
| `4:3` | `1344x1024` |
| `3:4` | `1024x1344` |

## Resolution Mapping (OpenRouter `video_submit`)

| CLI `--resolution` | `resolution` |
|---------------------|--------------|
| `1k` | `720p` |
| `2k` | `1080p` |
| `4k` | `1080p` |

## Error Codes

| Code | Meaning | Fix |
|------|---------|-----|
| 401 | Invalid API key | Check `IRONLABS_API_KEY`, run `/ironlabs:setup` |
| 402 | Insufficient balance | Run `/ironlabs:add-credits` |
| 400 | Bad request | Check prompt format / connector config |
| 500 | OpenRouter error | Retry; check the OpenRouter connector is connected in IronLabs Settings |

---
