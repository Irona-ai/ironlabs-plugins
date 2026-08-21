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
`reference_image_urls` — **confirmed working, not speculative.** Maps to OpenRouter's real `input_references` field (documented at [openrouter.ai/docs/api/api-reference/video-generation/create-videos](https://openrouter.ai/docs/api/api-reference/video-generation/create-videos)), capped per-model server-side via `maxInputReferences`. `ironlabs-cli.mjs` sends every attached `ref_image` material here, in upload order — bind to each with `@Image1`, `@Image2`, ... in the prompt.
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

### Multi-reference and video continuation

**Multi-reference (`@Image1`/`@Image2` binding)** goes through the standard
`video_submit` tool — pass `reference_image_urls` and bind each entry to
`@Image1`, `@Image2`, ... in the prompt, in array order. The connector maps them
to OpenRouter's `input_references` field and caps the list at the model's
`maxInputReferences`, so no separate call path is needed.

**Video-to-video continuation is not available.** No model reachable through the
connector accepts a video input — OpenRouter's video API has no video-to-video
mode at all. `ref_video` is a hard error, not a silent no-op. For continuity
between clips, extract a tail frame with ffmpeg and pass it as `first_frame` on
the next generation.

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

## Models (ironlabs-cli.mjs)

Real OpenRouter ids — there is no alias layer. A bare slug is accepted and
expanded (`seedance-2.0` → `bytedance/seedance-2.0`) by a normalizer that
mirrors irona-chat's `resolveToORModel()`; an unrecognized bare slug is a hard
error rather than a silent fallback to the default model.

| Model | Type | Notes |
|-------|------|-------|
| `x-ai/grok-imagine-video` | Video (async) | Default |
| `kwaivgi/kling-v3.0-pro` | Video (async) | Fast tier |
| `bytedance/seedance-2.0` | Video (async) | Highest `maxInputReferences` |
| `alibaba/happyhorse-1.1` | Video (async) | Alt model |
| `google/gemini-3.1-flash-image-preview` | Image (sync) | Default image |

Any other full `provider/model` path is passed through to the connector as-is.
Models outside the table above have no local pricing data, so `credit estimate`
reads `0 credits` / "No pricing data" for them — a missing-data gap, not an
indication the call is free.

## Material Roles

| Role | Sent as | Description |
|------|---------|--------------|
| `first_frame` | `image_url` | Pin opening frame |
| `last_frame` | `last_image_url` | Pin closing frame. Model-gated: the connector checks `supportsLastFrame` and throws a clear error for models that don't support it (including `x-ai/grok-imagine-video`, the default) rather than forwarding an invalid combination. |
| `ref_image` (1+) | `image_url` (first one) + `reference_image_urls` (all of them) | Style/identity reference. Bind each to `@Image1`, `@Image2`, ... in the prompt, in upload order. Maps to OpenRouter's `input_references` field and is capped per-model server-side via `maxInputReferences`. |
| `ref_video` | — | **Not supported on any model.** OpenRouter's video API has no video-to-video mode. Passing `ref_video` is a hard error, not a silent no-op — extract a tail frame with ffmpeg and pass it as `first_frame` instead. |

Materials are stored locally in `~/.ironlabs/materials/` as base64 by `ironlabs-cli.mjs`.

## Aspect Ratios

`16:9`, `9:16`, `1:1`, `4:3`, `3:4`

## Image Size (OpenRouter `image_generate`)

`--ratio` is forwarded verbatim as the tool's `size` argument, which accepts
either an aspect-ratio hint (`"16:9"`) or explicit pixels (`"1536x1024"`). The
CLI no longer pre-converts ratios to pixel dimensions — the connector owns that
interpretation.

## Image Seeds (`image_generate`)

`--seed` is forwarded as the tool's `seed` argument. The connector keys its
generation cache on the exact request body, so reusing a seed replays the
previously generated image instead of re-generating it. Omitting `--seed`
means every repeat request misses the cache and produces a new result.

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
