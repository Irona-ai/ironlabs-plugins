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
      "prompt": "A cat dancing on the moon, cinematic.",
      "model": "x-ai/grok-imagine-video",
      "image_url": "data:image/jpeg;base64,<b64>",
      "last_image_url": "data:image/jpeg;base64,<b64>",
      "duration": 5,
      "aspect_ratio": "16:9",
      "resolution": "720p"
    }
  }
}
```
`image_url` (first frame) is optional — omit it for pure text-to-video. Include it for image-to-video (first-frame/ref_image material).
`last_image_url` is optional. Response: `{ id, polling_url, status }`.

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

| Alias | OpenRouter model | Type |
|-------|-------------------|------|
| `ironlabs-2.0` | `x-ai/grok-imagine-video` | Video (default) |
| `ironlabs-2.0-fast` | `kwaivgi/kling-v3.0-pro` | Video fast |
| `youmeng-2.0` / `seedance-2.0` / `sd-2.0` | `bytedance/seedance-2.0` | Video alt |
| `nano-banana-2` | `google/gemini-3.1-flash-image-preview` | Image (default) |
| `nano-banana-pro` | `google/gemini-3.1-flash-image-preview` | Image (currently same model as `nano-banana-2`) |
| `midjourney-v7` | `google/gemini-3.1-flash-image-preview` | Image artistic |
| `gpt-image-2` | `google/gemini-3.1-flash-image-preview` | Image GPT-based |

Pass any `provider/model` path directly to skip aliasing.

## Material Roles (OpenRouter input params)

| Role | OpenRouter input field | Description |
|------|------------------------|--------------|
| `first_frame` | `image_url` (video) | Pin opening frame |
| `last_frame` | `last_image_url` (video) | Pin closing frame |
| `ref_image` | `image_url` (image or video) | Style reference (also used as first frame) |

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
