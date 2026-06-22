# IronLabs API Reference

## Base URL & Auth

```
Base URL: https://chat.irona.ai/api/v1   (or IRONLABS_BASE_URL if set)
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
  "scope": ["fal"],
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
    "scope": ["fal"]
  }
}
```

Scope values: `"fal"` for generation, `"openrouter"` for Gemini analysis.

---

### MCP Connector — Video/Image Generation (FAL)

| Method | Path | Description |
|--------|------|-------------|
| POST | `/mcp/fal` | Run FAL AI model via MCP connector |

Auth: `Authorization: Bearer <sandbox_token>` (NOT the API key — use token from `/ext/token`)

**Request — MCP JSON-RPC:**
```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "method": "tools/call",
  "params": {
    "name": "fal_run",
    "arguments": {
      "model": "fal-ai/minimax/video-01",
      "input": {
        "prompt": "A cat dancing on the moon, cinematic.",
        "aspect_ratio": "16:9",
        "duration": 5
      }
    }
  }
}
```

**Request — with reference image:**
```json
{
  "params": {
    "name": "fal_run",
    "arguments": {
      "model": "fal-ai/minimax/video-01",
      "input": {
        "prompt": "...",
        "first_frame_image_url": "data:image/jpeg;base64,<b64>",
        "aspect_ratio": "16:9",
        "duration": 5
      }
    }
  }
}
```

**Response:**
```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "result": {
    "content": [{
      "type": "text",
      "text": "{\"video\":{\"url\":\"https://...\",\"thumbnail_url\":\"https://...\"},\"seed\":123}"
    }],
    "isError": false
  }
}
```

The `content[0].text` is a JSON string — parse it to get the FAL result. Key fields:
- `video.url` — generated video URL
- `images[0].url` — generated image URL (for image models)

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

## FAL Model Aliases (renoise-cli.mjs)

| Alias | FAL Model | Type |
|-------|-----------|------|
| `renoise-2.0` | `fal-ai/minimax/video-01` | Video (default) |
| `renoise-2.0-fast` | `fal-ai/minimax/video-01-lite` | Video fast |
| `nano-banana-2` | `fal-ai/flux/dev` | Image (default) |
| `nano-banana-pro` | `fal-ai/flux-pro/v1.1` | Image high fidelity |
| `midjourney-v7` | `fal-ai/ideogram/v2` | Image artistic |
| `gpt-image-2` | `fal-ai/gpt-image-1` | Image GPT-based |

Pass any `fal-ai/...` path directly to skip aliasing.

## Material Roles (FAL input params)

| Role | FAL input field | Description |
|------|----------------|-------------|
| `first_frame` | `first_frame_image_url` | Pin opening frame |
| `last_frame` | `last_frame_image_url` | Pin closing frame |
| `ref_image` | `first_frame_image_url` | Style reference (also used as first frame) |
| `ref_video` | `reference_video_url` | Motion/style carryover |

Materials are stored locally in `~/.ironlabs/materials/` as base64 by `renoise-cli.mjs`.

## Aspect Ratios

`16:9`, `9:16`, `1:1`, `4:3`, `3:4`

## FAL Image Size Mapping

| CLI ratio | FAL image_size |
|-----------|---------------|
| `1:1` | `square_hd` |
| `16:9` | `landscape_16_9` |
| `9:16` | `portrait_16_9` |
| `4:3` | `landscape_4_3` |
| `3:4` | `portrait_4_3` |

## Error Codes

| Code | Meaning | Fix |
|------|---------|-----|
| 401 | Invalid API key | Check `IRONLABS_API_KEY`, run `/ironlabs:setup` |
| 402 | Insufficient balance | Run `/ironlabs:add-credits` |
| 400 | Bad request | Check prompt format / connector config |
| 500 | FAL / OpenRouter error | Retry; check connector is connected in IronLabs Settings |

---
