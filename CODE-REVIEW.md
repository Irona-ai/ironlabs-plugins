# Code Review — image/video generation path

> Audit of the image/video generation path against the live `irona-chat` backend.
> Every finding was verified against the connector's actual source or by probing the
> deployed API — not inferred from comments. All findings below have been fixed in
> the working tree; see "Fixes applied".

## Scope

`skills/ironlabs-gen/` (the generation CLI and its references), `skills/director/`
(creative direction + batch script), `skills/visual-analysis/`, and the hooks that
gate them.

## Verified correct (for the record)

Checked against `irona-chat`, so the next reader does not have to re-derive it:

- Endpoint `POST /api/v1/mcp/ext/generate` exists and is auth-gated (probed: `401`;
  `/chat/balance` → `405`, so the base URL and routing are right).
- A raw `IRONLABS_API_KEY` bearer is accepted — `backend/utils/externalMcpAuth.ts:40`
  falls through to `authenticateApiToken` for any non-OAuth-prefixed key. The
  `/ext/token` sandbox token genuinely cannot be minted for these scopes.
- Tool names match `backend/constants/externalMcpToolsets.constants.ts:21-22`.
- Arguments match `AgentImageArgs` / `AgentVideoArgs` exactly — `prompt`,
  `user_prompt`, `model`, `image_url`, `aspect_ratio`, `quantity` / `duration`,
  `resolution`, `audio`. No field is invented and none is missing.
- Defaults match the server: `bytedance/seedance-2.0`,
  `google/gemini-3.1-flash-image-preview`, duration `10`, resolution `720p`.
- `isError: true`-on-HTTP-200 handling, SSE `data:` parsing, and the 900s client cap
  against the route's `maxDuration: 800` are all correct — the server gives up first,
  and that path is handled as a timeout rather than a raw stack trace.
- Video result URLs are public and re-fetchable (`/api/v1/video/generated?key=`
  presign-redirects with no auth), so `task chain` works as documented.

---

## 🔴 Bugs that cost money or silently lost work

### 1. ✅ `--quantity` discarded every image after the first
`image_generate` renders and **bills** N images. The CLI sent `quantity`, then kept
`orResult.images[0]` and dropped the rest — so `--quantity 4` paid for four images
and returned one, with no warning. `SKILL.md` advertised it as "a batch in one call".

**Fix:** store the full array as `imageUrls` (keeping `imageUrl` as the first for
compatibility), print every URL, and warn when fewer come back than were requested.
`credit estimate` now multiplies by quantity too — it had been quoting the
single-image price for a 4-image call, understating by 4x.

### 2. ✅ `--characters` was dead code — every character reference was dropped
`buildCreateParams` defaulted the role to `reference_image`, but `createTask` only
matches `ref_image` / `first_frame`. Nothing matched, so the material was discarded
without a word and the generation ran unanchored at full price. The same hole applied
to `--materials "asset:<id>"` with no explicit role. The CLI's own help, and
`director/SKILL.md`'s anchoring table, both told users to use exactly these forms.

**Fix:** a `normalizeRole()` alias table (`reference_image`/`reference`/`ref`/`image`
→ `ref_image`, `start_frame`/`first` → `first_frame`) applied to all three material
paths, plus a parse-time warning for any role that still isn't recognized — so a typo
can never again fail silently. Verified end-to-end against a stub connector: a
`--characters` ref now arrives as `image_url`.

### 3. ✅ The upload endpoint does not exist
`uploadMaterial()` POSTed to `{baseUrl}/upload`, which returns **404** on production
(there is no `pages/api/v1/upload*` and no rewrite; the only route under `/uploads`
is `pdf-proxy`). The "try the CDN, fall back to inline" branch therefore never once
succeeded — it cost every upload a doomed round-trip and printed a failure note.
`visual-analysis/scripts/analyze.mjs` hit the same dead route for >20MB files.

**Fix:** both now go straight to the inline `data:` URI path, which is the real,
working mechanism (the connector stages inline references into R2 itself). The CLI
warns above 8MB that the material is re-sent on every referencing call;
`analyze.mjs` reports the 20MB limit up front with the ffmpeg commands to get under
it, instead of failing after a wasted request.

### 4. ✅ `batch-generate.sh` carried a dead async branch
It claimed videos return `pending` and polled with `task wait --timeout` — a flag the
CLI does not have, on a code path that is unreachable now that both tools are
synchronous. It also read `.duration` with no default, sending `--duration null` for
any shot that omitted it, and `2>/dev/null` on every call meant every failure read
"cli error" with the real reason discarded.

**Fix:** dead branch removed; `duration` defaults to 15; stderr is captured and the
actual message is printed on failure (verified: an unknown model now reports the
model list instead of "cli error"); `$CLI` is an array so a plugin path with spaces
survives; the summary loop is guarded for the empty-array case under `set -u`, which
aborts on macOS's bash 3.2.

### 5. ✅ `director/SKILL.md` documented an impossible recovery path
It told the model that generation "runs asynchronously server-side" and to fall back
to `task create` + `task wait <id> --timeout 900`. `task create` blocks identically,
and on failure no task record is written — so `task wait` reports "not found".

**Fix:** rewritten to state that generation is synchronous, to give the Bash call a
long explicit timeout, and to re-run the generate command on failure (checking
`credit me` first, since the upstream job may already have been billed).

---

## 🟠 Documentation that misdirected generation

`references/video-capabilities.md` is read *before every prompt session*
(`director/SKILL.md` hard rule), so its errors propagated into real generations:

- ✅ Default model read `x-ai/grok-imagine-video`. It is `bytedance/seedance-2.0` in
  both the CLI and the backend.
- ✅ A "Multi-Reference-to-Video (works on the default model)" section claimed
  `@Image1`/`@Image2` binding was "confirmed working" via `input_references`.
  `video_generate` takes exactly one `image_url`; there is no such field on any model.
  Rewritten as **NOT AVAILABLE**, with the compose-into-one-image workaround.
- ✅ Claimed an omitted duration defaults to "effectively 5s". It is 10s.
- ✅ Added the 720p default and a note that naming `--model` disables the connector's
  cross-model cache peek.

Also fixed:
- ✅ `director/SKILL.md` called `credit estimate` "the real cost" and quoted ~40
  credits, while the CLI returns "measured several times low" on that same call.
- ✅ Director examples pinned `--model`, defeating the cache peek that
  `ironlabs-gen/SKILL.md` tells you to preserve.
- ✅ "OpenRouter connector error" → the image/video generation connector.
- ✅ `api-endpoints.md` listed the analysis model as `google/gemini-3.5-flash`;
  `analyze.mjs` uses `google-ai-studio/gemini-3.5-flash`.
- ✅ `SKILL.md`'s "with multiple references" example passed two `ref_image`
  materials, which the CLI drops down to one.

---

## ⚪ Lower severity

- ✅ **`isImageModel` misrouted text models.** Any full path containing `gemini` was
  treated as an image model, so `google/gemini-3.5-flash` would have been billed as
  an image render. The heuristic now requires an image-shaped name
  (`flux`/`ideogram`/`gpt-image`/`imagen`/`seedream`/`image`).
- ✅ **`match-materials.mjs`** emitted every match comma-joined into one
  `--materials` flag; the connector uses one still, so the extras were warned about
  and dropped. It now emits the top match and lists runners-up as alternatives. Its
  `has_face` sentinel was renamed `asset` → `face-blocked` (`asset` is a real,
  different concept in this CLI) and now explains why the material is held back.
- ✅ **`hooks/check-api-key.sh`** only checked the environment variable, so a key
  configured via `.env` — which the scripts do read — was blocked on calls that would
  have worked. It also did not guard `analyze.mjs` / `material-ingest.mjs`, which
  authenticate the same way. Both fixed.
- ✅ **Version drift.** Manifests were `0.2.1`, `ironlabs-gen` `0.3.0`,
  `visual-analysis` `0.2.2`. All eight now read `0.3.0`.

### Not changed (intentionally)

- **`index.mjs` no-op stub** — the OpenClaw extension entry the manifest points at;
  removal is an integration decision, not a cleanup.
- **`runPreviousStatusLine` `execSync`** — low risk (the user's own `chmod 600`
  config), documented in place.
- **Video pricing placeholders in `OR_MODELS`** — left deliberately wrong-but-labelled
  rather than guessed at: the real figure varies by resolution and tier and comes back
  per job as `cost_usd`. The estimate carries an explicit warning instead.

---

## Verification

`npx tsc --noEmit` clean; `node --check` passes on all six `.mjs`; `bash -n` passes on
all six `.sh`. Generation paths were exercised end-to-end against a local stub
connector (no billed calls), confirming: `--characters` and role-less `asset:<id>`
now reach the connector as `image_url`; `--quantity 2` returns and prints both URLs;
an unknown role warns; the multi-`ref_image` warning still fires; `batch-generate.sh`
defaults a missing duration to 15s and surfaces the real error text on failure.
