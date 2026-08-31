# IronLabs API Reference

## Base URL & Auth

```
Base URL: https://www.chat.ironlabs.ai/api/v1   (or IRONLABS_BASE_URL if set)
Auth:     Authorization: Bearer <IRONLABS_API_KEY>
```

All generation goes through the **IronLabs "generate" MCP toolset** in one step:
POST the MCP JSON-RPC call to `/mcp/ext/generate` with `IRONLABS_API_KEY` as the
bearer token. There is no token-issuance step — the older `/ext/token` sandbox
token is deliberately unused, because its scope allowlist has no `image`/`video`
entry, so a token for these connectors cannot be minted at all.

Both generate tools are **synchronous**: the call blocks for the whole render and
returns the finished asset. There is no submit/poll/download cycle. Each result
reports which cache/provider tier served it (`source`) and what it cost
(`cost_usd`); the server-side chain is
**exact cache → semantic cache → MuAPI → OpenRouter fallback**.

---

## Endpoints

### Balance

| Method | Path | Description |
|--------|------|-------------|
| GET | `/chat/balance` | Current credit balance |

Response:
```json
{ "data": { "totalBalance": 1.50 } }
```
`totalBalance` is in **dollars**; `ironlabs-cli.mjs` normalizes it to cents
internally. A response without a usable `totalBalance` is treated as an error,
not as a zero balance.

---

### Generate Connector — Image (`image_generate`)

| Method | Path | Description |
|--------|------|-------------|
| POST | `/mcp/ext/generate` | Run `image_generate` — synchronous |

Auth: `Authorization: Bearer <IRONLABS_API_KEY>`.
Send `Accept: application/json, text/event-stream` — the endpoint may answer
either way, and the CLI parses the single `data:` line out of an SSE response.

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
      "user_prompt": "draw me a cat on the moon",
      "model": "google/gemini-3.1-flash-image-preview",
      "aspect_ratio": "1:1",
      "quantity": 1,
      "image_url": "data:image/jpeg;base64,<b64>"
    }
  }
}
```
Every argument except `prompt` is optional. `model` is sent only when the caller
picked one — omitting it lets the connector apply its own default **and** run its
cross-model cache peek, which it skips whenever a model is supplied.
`user_prompt` is the user's own wording and is what the cache keys on.
`image_url` turns the call into image-to-image (a `ref_image` or `first_frame`
material).

**Response** (inside the MCP text content, as JSON):
```json
{ "images": ["<url>"], "source": "<cache tier or provider>", "model": "...", "cost_usd": 0.06 }
```

---

### Generate Connector — Video (`video_generate`)

| Method | Path | Description |
|--------|------|-------------|
| POST | `/mcp/ext/generate` | Run `video_generate` — synchronous, blocks for the whole render |

**Request:**
```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "method": "tools/call",
  "params": {
    "name": "video_generate",
    "arguments": {
      "prompt": "A cat dancing on the moon, cinematic.",
      "user_prompt": "make my cat dance on the moon",
      "model": "bytedance/seedance-2.0",
      "image_url": "data:image/jpeg;base64,<b64>",
      "duration": 15,
      "aspect_ratio": "16:9",
      "resolution": "1080p",
      "audio": true
    }
  }
}
```
`image_url` (used as the first frame) is optional — omit it for pure
text-to-video.

**One still, and only one.** `video_generate` has no `last_image_url` and no
`reference_image_urls` field. `ironlabs-cli.mjs` sends the `first_frame`
material, or the first `ref_image` when no first frame was given, and prints a
warning for any extra `ref_image` or a `last_frame` rather than silently dropping
it. `@Image2`/`@Image3` prompt tokens have nothing to bind to.

**No video input on any model.** There is no `video_url` field — OpenRouter's
video API documents only text-to-video, image-to-video and reference-to-video for
every model it carries. `ref_video` is a hard error from the CLI, not a silent
no-op.

**Response:**
```json
{ "url": "<video-url>", "source": "...", "model": "...", "cost_usd": 0.53 }
```
The URL is returned ready to use — there is no separate download/auth step.

---

### Call Semantics (both tools)

- **Timeout:** the CLI caps a single generate call at 900s (`MCP_CALL_TIMEOUT_MS`).
  A render that outruns the server's request budget shows up as a torn stream or
  a 200 with no event; both are reported as a 504-style timeout. The job may
  still have run and been billed upstream.
- **Tool-level errors come back as HTTP 200** with `result.isError: true` and the
  reason in the text content — including insufficient balance, which is *not* an
  HTTP 402 on this endpoint. Check `isError` before parsing the payload.

---

### Multi-reference and video continuation

**Multi-reference is not available on video.** `video_generate` accepts a single
still, so there is no `@Image1`/`@Image2` binding to set up. Compose the
references into one image first (via `image_generate`) and pass that as the
first frame.

**Video-to-video continuation is not available.** No model reachable through the
connector accepts a video input. For continuity between clips, extract a tail
frame with ffmpeg and pass it as `first_frame` on the next generation.

---

### Visual Analysis (not a generation connector)

Image/video analysis does **not** go through `/mcp/ext/generate`. It runs natively
on Irona's LLM gateway — `skills/visual-analysis/scripts/analyze.mjs` creates a
throwaway conversation via `POST /chat/conversation`, then streams
`POST /chat/completions` (SSE) with `IRONLABS_API_KEY`:

```json
{
  "models": ["google/gemini-3.5-flash"],
  "messages": [{
    "role": "user",
    "content": [
      { "type": "image_url", "image_url": { "url": "<uploaded-url>" } },
      { "type": "text", "text": "Analyze this product photo." }
    ]
  }],
  "stream": true,
  "conversationId": "<id>"
}
```

`/chat/completions` rejects unrecognized body keys — `temperature`, `max_tokens`
and `response_format` each return a 400 `Unrecognized key(s)`. JSON output is
requested in the prompt instead.

---

## Models (ironlabs-cli.mjs)

Real OpenRouter ids — there is no alias layer. A bare slug is accepted and
expanded (`seedance-2.0` → `bytedance/seedance-2.0`) by a normalizer that
mirrors irona-chat's `resolveToORModel()`; an unrecognized bare slug is a hard
error rather than a silent fallback to the default model.

Both tools are synchronous, so every model below returns its finished asset from
the one call.

| Model | Type | Notes |
|-------|------|-------|
| `bytedance/seedance-2.0` | Video | **Default video** |
| `x-ai/grok-imagine-video` | Video | Alt video model |
| `kwaivgi/kling-v3.0-pro` | Video | Fast tier |
| `alibaba/happyhorse-1.1` | Video | Not on MuAPI — always billed via OpenRouter |
| `google/gemini-3.1-flash-image-preview` | Image | **Default image** (Nano Banana 2) |
| `google/gemini-3.1-flash-lite-image` | Image | Cheapest image |
| `google/gemini-3-pro-image-preview` | Image | Highest quality |
| `google/gemini-2.5-flash-image` | Image | Nano Banana 1 |
| `x-ai/grok-imagine-image-quality` | Image | Alt image model |
| `bytedance-seed/seedream-4.5` | Image | Alt image model |

Any other full `provider/model` path is passed through to the connector as-is.
Models outside the table above have no local pricing data, so `credit estimate`
reads `0 credits` / "No pricing data" for them — a missing-data gap, not an
indication the call is free.

## Material Roles

| Role | Sent as | Description |
|------|---------|--------------|
| `first_frame` | `image_url` | Pin opening frame (video); reference image (image-to-image) |
| `ref_image` | `image_url` — the first one only | Style/identity reference. Extra `ref_image` materials are **not** sent: the tools have no `reference_image_urls` field, so the CLI warns and uses only the first. |
| `last_frame` | — | **Not supported.** `video_generate` has no `last_image_url` field; the CLI warns and ignores the material. |
| `ref_video` | — | **Not supported on any model.** OpenRouter's video API has no video-to-video mode. Passing `ref_video` is a hard error, not a silent no-op — extract a tail frame with ffmpeg and pass it as `first_frame` instead. |

Materials are stored locally in `~/.ironlabs/materials/` as base64 by `ironlabs-cli.mjs`.

## Aspect Ratios

`16:9`, `9:16`, `1:1`, `4:3`, `3:4`

## Image Size (`image_generate`)

`--ratio` is forwarded as the tool's `aspect_ratio` argument. There is no `size`
or pixel-dimension argument — the CLI does not convert ratios to pixels, and the
connector owns the resolution it renders at. `--resolution` does not apply to
images; passing it prints a note and is ignored.

## Reproducibility / Cache Reuse (`image_generate`, `video_generate`)

There is no seed argument — the CLI has no `--seed` flag and the connector takes
none. Repeat generations are deduplicated by the connector's cache instead, which
keys on the request and on the user's own wording rather than on an expanded
prompt. Pass `--user-prompt` with the user's original phrasing so a repeat ask
hits that cache (and shares hits with the chat app); without it, a repeat request
misses the cache and produces a new result at full cost.

## Resolution Mapping (`video_generate`)

| CLI `--resolution` | `resolution` |
|---------------------|--------------|
| `1k` | `720p` |
| `2k` | `1080p` |
| `4k` | `1080p` (video models top out at 1080p; the CLI prints a note) |

## Error Codes

| Code | Meaning | Fix |
|------|---------|-----|
| 401 | Invalid API key | Check `IRONLABS_API_KEY`, run `/ironlabs:setup` |
| 402 | Insufficient balance (HTTP-level, e.g. on `/chat/balance`) | Run `/ironlabs:add-credits` |
| 400 | Bad request | Check prompt format / connector config |
| 500 | Upstream provider error | Retry; check the generation connector is connected in IronLabs Settings |
| 504 | Render outran the request budget, or no result before the 900s cap | Retry, or use a shorter `--duration`. The job may still have been billed upstream |

On `/mcp/ext/generate`, most failures — insufficient balance included — arrive as
an HTTP **200** with `result.isError: true` and the reason in the text content,
per the MCP protocol. Do not treat a 200 as success without checking that flag.

---
