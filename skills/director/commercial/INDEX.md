# Commercial Video — Index

E-commerce, advertising, and brand video production guide. Break down vague creative briefs into precise, controllable AI video prompts using the six-dimension formula, then generate via `ironlabs-cli.mjs`.

---

## Step 1: Identify the Scenario

Route by asking these questions in order — stop at the first match:

1. **Does the user want a presenter speaking on camera?** ("口播", "带货", "测评", "主播出镜") → **D**
2. **Does the user provide a reference video to replicate?** → **A**
3. **Is this a brand film longer than 5s, or explicitly multi-shot?** → **C**
4. **Otherwise** (quick single-shot product showcase, ≤5s) → **B**

| Scenario | Trigger | Read |
|----------|---------|------|
| **A — Viral Replication** | User provides a viral/trending video and wants to replicate its style with their own product | `Read ${CLAUDE_SKILL_DIR}/commercial/scenario-a-viral.md` |
| **B — Product Showcase** | Single-shot product close-up, ≤5s — one API call, product is the sole subject | `Read ${CLAUDE_SKILL_DIR}/commercial/scenario-b-brand.md` |
| **C — Brand Film / TVC** | Brand film >5s, or multi-shot narrative — may include product-only shots as segments | `Read ${CLAUDE_SKILL_DIR}/commercial/scenario-c-tvc.md` |
| **D — UGC / Live-Presenter** | Real person presenting on camera — review, testing, talking-head endorsement, 带货口播 | `Read ${CLAUDE_SKILL_DIR}/commercial/scenario-d-ugc.md` |

> Scenario D overlaps with `${CLAUDE_SKILL_DIR}/references/ecom-guide.md`, which already covers the common 15s hook/showcase/scene/close structure, dialogue formulas, BGM table, and category keywords for TikTok-style product videos. Read both — `ecom-guide.md` for the tactical phrase bank, `scenario-d-ugc.md` for the UGC-authenticity framework (Demo Action Framework, honest-flaw embedding, hook typing) layered on top of it.

---

## Core Formula

Every prompt must cover these six dimensions, assembled in this order:

```text
Subject + Selling-Point Action + Scene & Tone + Camera Language + Audio + Post-Production Constraints
```

| Dimension | Definition | Ask yourself |
|-----------|-----------|-------------|
| **Subject** | The absolute visual center — determines audience identification and product perception | What should the viewer see first? |
| **Selling-Point Action** | Translate abstract sales copy into concrete micro-actions or pain-point scenarios | What visible action makes the viewer "see" the selling point? |
| **Scene & Tone** | Shooting environment, lighting, art direction | Where should the viewer feel they are? |
| **Camera Language** | Specific angles and transitions that create visual hooks and impact | How should the camera move to grab attention? |
| **Audio** | Sound effects / beat sync — pre-embed visual actions that align with audio cues | Which moment must synchronize with sound? |
| **Post-Production Constraints** | Reserve space for overlays; set negative rules (prohibitions) | What flaws must never appear on screen? |

---

## Asset Reference Rules

Use `@` references in prompts to anchor visuals to the user's assets. Each reference must state **what is being referenced** and **what it's being used for**:

```text
the serum glass bottle from @Image 1         ← what was referenced + what info was extracted
reference the camera movement of @Video 1    ← explicitly only partial features, not everything
```

| Reference type | Prompt syntax | `--materials` role | Notes |
|---------------|--------------|---------------------------|-------|
| Product / scene image (no faces) — **one only** | plain description | `ID:ref_image` or `ID:first_frame` | `video_generate` takes a single still. Extra `ref_image` materials are ignored with a warning, and `@Image N` tokens have nothing to bind to — compose multiple references into one image first. |
| Scene image with incidental faces (face NOT the reference target) | `@Image N` | `ID:ref_image` | Treat as scene ref |
| Person image where face IS the character identity | `@Image N` | `ID:ref_image`, or `asset:ID:ref_image` if reused often | See Face Privacy Rule below — real faces may still be blocked regardless of upload path |
| Reference video | — | **not supported** | No model accepts a video input — OpenRouter has no video-to-video mode. `ref_video` is a hard error. Chain your own segments with tail-frame → `first_frame` instead; for external style, use Gemini analysis. |
| First frame | plain description | `ID:first_frame` | The one still the video opens on. Takes precedence over any `ref_image` — they do not combine |

**Face Privacy Rule**: Human faces passed as `ref_image` may trigger privacy detection in some OpenRouter video/image models. Unlike a hard, guaranteed block, this is model-dependent — but treat it as likely. Registering an image as an asset (`asset create`) does **not** bypass this check; asset registration is purely a reuse convenience, not a privacy workaround. When a real face photo is blocked, or as the default for any presenter/character face:

- Generate an AI portrait of the character (`google/gemini-3.1-flash-image-preview` or similar) and use that as the reference instead of the real photo, **or**
- Describe the person in text only, with no uploaded face material.

Do this automatically without waiting for a block — real face photos are the exception, not the default path.

---

## Common Workflow

### Phase 1: Requirement Gathering & Asset Analysis

1. **Identify the scenario** — match to A/B/C/D using the table above, then load that scenario file
2. **Asset inventory** — view each image/video the user provides:
   - Images: Read tool → analyze (product? scene? person?)
   - Videos: use `gemini-gen` analysis if available; otherwise ask user to describe key frames
3. **Tag each asset**:
   - `has_face: true` → default to text-only description or an AI-generated portrait instead (see Face Privacy Rule)
   - Assign role: subject anchor / scene calibration / camera reference / beat-sync control
4. **Confirm generation parameters**:
   - Duration: 5–15s per segment (the CLI accepts any integer in this range; over 15s → multi-segment chaining)
   - Aspect ratio: `16:9`, `9:16`, `1:1`, `4:3`, or `3:4`, based on the user's request
   - Model — **prefer omitting `--model`**: the default is `bytedance/seedance-2.0`, and leaving the flag off also lets the connector check whether this request already rendered under another video model before paying to generate it again.

| Model | Notes |
|-------|-------|
| `bytedance/seedance-2.0` | **Default video model** |
| `x-ai/grok-imagine-video` | Alt video model |
| `kwaivgi/kling-v3.0-pro` | Alt video model |
| `alibaba/happyhorse-1.1` | Alt video model — not on MuAPI, always billed via OpenRouter |
| `google/gemini-3.1-flash-image-preview` | **Default image model** |

Full model/material/resolution details live in `Read ${CLAUDE_PLUGIN_ROOT}/skills/ironlabs-gen/references/video-capabilities.md` and `Read ${CLAUDE_PLUGIN_ROOT}/skills/ironlabs-gen/references/api-endpoints.md` — read those before picking a non-default model. All generation goes through the image/video connector, which enforces each model's capability limits server-side. Multi-reference/`@ImageN` binding works on **no** model — video takes a single still. `ref_video` works on none of them either; OpenRouter has no video-to-video mode.

> **Scenario D only**: After Phase 1, execute Phase 1.5 (asset pre-upload) before writing any prompt. See `scenario-d-ugc.md`.

### Phase 2: Prompt Construction

Build the prompt following the matched scenario file's structure. The six-dimension formula always applies, but the organization (paragraph-per-dimension / shot-by-shot / second-by-second timeline) is scenario-specific.

**Language rule**: Draft in the user's language. Translate to English in Phase 4 Step 3 — never before user confirmation. **Exception: Scenario D with dialogue — keep the entire prompt in the user's language permanently**, because the model generates lip-synced speech from the dialogue text embedded in the prompt.

**DO:**
- Place `@` references immediately next to their descriptions, stating what was referenced and what it's used for
- When referencing a video, explicitly annotate "reference only XX, NOT YY"
- Use concrete micro-actions — never abstract adjectives like "premium" or "cinematic"
- Include at least 2 negative rules (prohibitions) for the most failure-prone elements

**DON'T:**
- Write vague terms → replace with specific lighting / color / material / motion descriptions
- Omit any of the six dimensions
- Assume the AI understands brand tone → anchor every visual standard with `@` assets

> **⚠️ Physical Continuity Rule and Action Granularity Rule (apply to all scenarios)** — already covered in `Read ${CLAUDE_SKILL_DIR}/references/ecom-guide.md`. Read that section before writing any demo/product-interaction prompt; it applies here unchanged.

### Phase 3: User Confirmation

> 🚨 **HARD RULE — Language**: The entire Phase 3 preview MUST be written in the **user's language** (Chinese if user spoke Chinese, etc.). This includes every prompt dimension, every description, every label. **NEVER show English prompt text to the user during preview.** English translation happens ONLY in Phase 4 Step 3, silently, right before the API call. Showing English here is a workflow violation.

Present the full prompt in the standard preview format and wait for explicit confirmation before Phase 4:

```text
--- Prompt Preview ---

[Full prompt in USER'S LANGUAGE, each dimension as its own paragraph, tagged with [维度名称] / [Dimension Name] in user's language]

--- Asset Mapping ---
Reference still → [filename / description] → role: first_frame (one still only)
@Video 1 → [filename / description] → Gemini analysis only (NOT uploaded for generation)

--- Generation Parameters ---
Model: (omit --model unless a specific one is needed; default bytedance/seedance-2.0)
Duration: N seconds
Aspect ratio: W:H
Estimated cost: run `ironlabs credit estimate --model <model> --duration <seconds>` (no API key required)
---
```

> **Scenario C** uses a different storyboard preview format. See `scenario-c-tvc.md`.

The user may request: modify a dimension → change only that dimension, re-present | adjust an asset role → update mapping, re-present | switch scenario → return to Phase 2.

### Phase 4: Asset Upload & Video Generation

**Step 1 — Upload assets**

> **Scenario D**: If Phase 1.5 was executed, person and product assets are already uploaded — skip re-uploading. Only upload NEW materials not handled in Phase 1.5.

```bash
# One-off use in a single generation
node ${CLAUDE_PLUGIN_ROOT}/skills/ironlabs-gen/ironlabs-cli.mjs material upload <file_path>
# → prints material ID, e.g. 194 — use as "194:ref_image"

# Reused across many generations/projects — register once instead
node ${CLAUDE_PLUGIN_ROOT}/skills/ironlabs-gen/ironlabs-cli.mjs asset create <file_path>
# → prints asset ID, e.g. 27 — use as "asset:27:ref_image"
```

Unlike a two-step "upload then register" flow, `asset create` (and its alias `asset register`) takes the file path directly — there's no separate registration step against an already-uploaded material ID.

**Step 2 — Build the final asset mapping table**

Record all `material_id` / `asset_id` values and their roles.

**Step 3 — Prompt language decision**

- **With dialogue (Scenario D)**: Keep prompt in the user's language. Do NOT translate.
- **Without dialogue (A/B/C)**: Translate to English. Use professional cinematography terminology. Keep selling-point action descriptions precise.

**Step 4 — Generate**

```bash
node ${CLAUDE_PLUGIN_ROOT}/skills/ironlabs-gen/ironlabs-cli.mjs task generate \
  --prompt "<prompt>" \
  --duration <seconds> \
  --ratio <ratio> \
  --materials "<id>:first_frame"
```

> **Scenario C multi-clip**: See assembly instructions in `scenario-c-tvc.md` under "Mode B: Multi-clip".

**Step 5 — Multi-segment continuity** (only when total video exceeds 15s)

Tail-frame → `first_frame` is the continuity method — it works on every model here. There is no video-to-video alternative: no model accepts a clip as input.

```bash
ffmpeg -sseof -0.2 -i generated/shots/S1.mp4 -frames:v 1 -q:v 2 -y generated/keyframes/S1-end.jpg
node ${CLAUDE_PLUGIN_ROOT}/skills/ironlabs-gen/ironlabs-cli.mjs material upload generated/keyframes/S1-end.jpg
# → prints material_id
node ${CLAUDE_PLUGIN_ROOT}/skills/ironlabs-gen/ironlabs-cli.mjs task generate \
  --prompt "Continuing from the previous shot: <segment 2 prompt>" \
  --materials "<S1_end_material_id>:first_frame"
```

**Step 6 — Return results**

Present: video URL, cover image, generation time. If unsatisfactory, ask which dimension to adjust and regenerate.

---

## IronLabs CLI Reference

```bash
CLI=${CLAUDE_PLUGIN_ROOT}/skills/ironlabs-gen/ironlabs-cli.mjs

# Upload material (one-off use)
node "$CLI" material upload <path>

# Register a reusable asset directly from a file
node "$CLI" asset create <path>

# Generate video (blocks until done)
node "$CLI" task generate \
  --prompt "prompt" \
  --duration 10 --ratio 9:16 \
  --materials "asset:id2:ref_image"

# Check balance
node "$CLI" credit me
```

**Materials do NOT combine — video takes one still.** `video_generate` has a single `image_url` argument. The CLI sends the `first_frame` material, or the first `ref_image` if no first frame was given, and warns that anything else was ignored. `last_frame` is not supported on any model, and `ref_video` is a hard error. To use more than one reference, compose them into a single image with `image_generate` and pass that.

**Timing note**: Video generation is **synchronous** — `task generate` blocks for the whole render (~3–10 minutes per segment) and returns the finished asset. There is no pending state: `task create` blocks identically, and `task wait` is a no-op kept for script compatibility. Give the Bash call a long explicit timeout (15 min). If it fails, **re-run the generate command** — no task record is written on failure, so `task wait`/`task result` will report "not found", and the upstream job may already have been billed (check `credit me` first).

**Cost**: `credit estimate --duration <seconds>` needs no API key, but **video estimates are unverified placeholders that have measured several times low** — use them to flag "this will be expensive", never to quote a price. The billed figure comes back on each result as `costUsd`.

---

## Troubleshooting

| Problem | Fix |
|---------|-----|
| Privacy/face detection blocked | Use an AI-generated portrait instead of the real photo, or describe the character in text only. `asset create` does not bypass this. |
| 402 insufficient credits | `credit me`, inform user, suggest top-up at https://www.chat.ironlabs.ai/ |
| Character drifts between segments | Use a material/asset `ref_image` + copy the full character description verbatim across segments |
| Video ignores actions in prompt | Prompt too dense — reduce to 3–4 actions per 5s window |
| Video looks incoherent | Simplify: 2 camera stages, one mood, fewer actions |
| Segments don't connect | Use tail-frame → `first_frame` for exact state handoff — the only confirmed continuity method |

---

## Important Notes

1. **Language**: Draft in user's language. Translate to English before the API call — except Scenario D (dialogue prompts stay in user's language for lip-sync)
2. **Asset limits**: video takes exactly **one** still — extra `ref_image` materials are ignored with a warning, and `@Image1`/`@Image2` binding does not exist. Compose multiple references into one image first — see Asset Reference Rules above
3. **Duration**: 5–15s per segment; use tail-frame → `first_frame` chaining for longer videos
4. **Face privacy**: default to AI-generated portraits or text-only descriptions for any character/presenter face — don't rely on asset registration as a workaround
5. **Aspect ratio**: Once confirmed, all reference images should match the same ratio
6. **Cost**: run `credit estimate --duration <seconds>` before generating (no API key needed), but treat video figures as indicative only — they have measured several times below the billed amount. Check `credit me` for remaining balance and notify the user proactively if it's low
