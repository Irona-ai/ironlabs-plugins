# IronLabs Video Model Capabilities

Model reference only. For prompt writing guidance, see `Read ${CLAUDE_SKILL_DIR}/../director/references/prompt-craft.md`.

## Default Model Specs

| Parameter | Value |
|-----------|-------|
| Default model | `x-ai/grok-imagine-video` (alias `ironlabs-2.0`) |
| Min duration | 5 seconds |
| Max duration | 15 seconds |
| Duration options | Any integer 5–15s |
| Resolution | Up to 1080p |
| Aspect ratios | `16:9`, `9:16`, `1:1`, `4:3`, `3:4` |

Override with the `--model` flag.

---

## Model Reality Check

**The model generates continuous video — it is NOT a video editor.**

### What the model does well
- Smooth continuous camera movements (push in, pull back, orbit, track)
- Gradual transitions within a single shot (close-up drifting to medium)
- Consistent character appearance within one 15s generation
- Lip-sync dialogue when using the exact word-for-word embedding format
- Atmospheric scenes with clear mood (one mood per segment)
- Simple cause-and-effect actions (hand picks up cup, person walks forward)

### What the model does poorly or cannot do
- **Hard cuts / jump cuts** — generates continuous flow, not edited footage
- **Shot-reverse-shot** — camera cannot teleport to a new angle mid-generation
- **Dolly zoom / vertigo effect** — too complex, produces artifacts
- **Rapid montage of 5+ setups** — becomes incoherent
- **Precise slow-motion timing** — approximate at best
- **Complex multi-character choreography** — characters may merge or disappear
- **Reading/displaying text on screen** — unreliable
- **Maintaining exact face identity across separate generations** — always drifts

### The golden rule
**One mood, one scene, one continuous camera flow per 15s segment.**

---

## Input Types

### Text-to-Video — Recommended Default
- No materials needed
- Most stable mode, not subject to privacy detection
- Suitable for: all scenarios

### Image-to-Video
- Material role: `ref_image`
- **⚠️ Privacy detection**: Images with realistic human faces may be blocked
- Suitable for: product photos (no faces), landscapes, illustrations, scene refs

### Multi-Reference-to-Video (works on the default model)
- Material role: `ref_image`, 2 or more
- Bind each to `@Image1`, `@Image2`, ... in `--prompt`, in upload order — confirmed working directly on `ironlabs-2.0` via OpenRouter's `input_references` field, no model switch needed
- `--model grok-multiref` is an alternative path to the same capability (calls the same underlying model directly via fal, runs synchronously — do not `task wait` for it); reach for it only if you specifically want that synchronous behavior
- Same privacy-detection caveat applies to any reference image with a real face

### Best Practices
Default to **Text-to-Video**. Only use reference materials for:
- Pure product photos (no faces) → `ref_image`
- Abstract/landscape references → `ref_image`
- Exact carried-over opening state from a previous segment → `first_frame`
- **Human faces** → describe in text only. Do NOT pass face photos as `ref_image`.

---

## Duration Strategy

`--duration` accepts any integer 5–15s. **Always pass it explicitly** — the CLI does not default to 15s. If omitted, the flag is never sent to OpenRouter and the API applies its own default (effectively 5s). The recommended segment length is 15s; treat it as the standard working unit and pass `--duration 15` unless a shorter duration is justified (e.g. music beat alignment, pacing needs).

| | Single 15s | Stitched segments |
|---|---------|----------|
| Character consistency | Naturally consistent | Drifts between segments |
| Camera fluidity | Continuous movements | Each segment independent |
| Music/SFX | Natural flow | Needs post-production BGM |
| Cost | 1 API call | N API calls |

---

## Camera Movement Reliability

| Movement | Reliability | Notes |
|----------|-------------|-------|
| Slow push in / dolly in | ★★★ | Most reliable. Default for emotional scenes |
| Pull back / reveal | ★★★ | Great for establishing shots |
| Smooth orbit | ★★★ | Excellent for product showcase |
| Tracking alongside subject | ★★★ | Works well with clear linear motion |
| Tilt up / tilt down | ★★★ | Simple, effective reveals |
| Static / locked-off | ★★★ | Reliable for held moments |
| Crane up (rising) | ★★☆ | Usually works, sometimes jerky |
| Handheld feel | ★★☆ | Adds texture, can be excessive |
| Slow motion | ★★☆ | Approximate, not frame-accurate |
| Low angle / worm's eye | ★★☆ | Works for static setups |
| Overhead / bird's eye | ★★☆ | Works for static scenes |
| Whip pan | ★☆☆ | Unpredictable |
| Dolly zoom / vertigo | ★☆☆ | Rarely executes correctly |
| Rack focus | ★☆☆ | Model doesn't reliably control focus |
| Dutch angle | ★☆☆ | Often ignored |

**Stick to ★★★ and ★★☆.** Only use ★☆☆ if willing to re-generate.

---

## Visual Consistency

### Style Anchor — what goes where

**In the anchor (same for every segment):**
- Film texture: `cinematic, shallow depth of field, film grain`
- Art style: `historical period drama` or `3D CG animation`

**NOT in the anchor:**
- Color mood that changes between scenes (warm/cold)
- Emotional tone, weather, time of day
- Scene-specific details

```
GOOD: Cinematic period drama, shallow depth of field, film grain.
BAD:  Warm amber tones shifting to cold blue-grey, cinematic, tense atmosphere.
```

### Available anchors (combinable)

| Anchor | Strength | What it locks |
|--------|----------|---------------|
| `path:ref_image` (scene ref, no faces) | Medium | Environment, lighting, color palette |
| `path:first_frame` (extracted tail frame) | Strong | Exact opening composition of next segment |
| Text-only description | Weak | Nothing locked visually — model may drift |

More anchors = stronger consistency, but longer generation time (8–12 min with multiple anchors vs 5–8 min text-only). Use only what each segment actually needs.

---

## Multi-Segment Continuity

For sequential segments on the default model (`ironlabs-2.0` / any OpenRouter model), use tail-frame → next `first_frame` when the next segment must open on an exact carried-over pose/composition/state, or when you need a clean visual handoff of gaze, props, or lighting. This is the only continuity method that works on these models — none of them accept a previous-segment video as input, confirmed by reading the actual connector code (not just undocumented).

**A second, genuinely different continuity method exists, but on a different model.** `--model veo-3.1-extend` (or `veo-3.1-extend-fast`) calls Google's Veo 3.1 directly via fal.ai and actually continues an existing clip's motion — not a still frame, the real video:

```bash
CLI=${CLAUDE_PLUGIN_ROOT}/skills/ironlabs-gen/ironlabs-cli.mjs

# S1 already generated and saved as a task
CLIP1_MAT=$(node "$CLI" task chain <S1-task-id> | jq -r '.material.id')
node "$CLI" task generate --model veo-3.1-extend \
  --prompt "Continue the scene naturally, same motion and style" \
  --materials "${CLIP1_MAT}:ref_video"
```

Trade-offs vs. tail-frame → `first_frame`: this switches you off `ironlabs-2.0` onto a different model/provider entirely (Veo 3.1, not grok-imagine-video), adds up to 7s per call (chainable toward ~30-148s depending on tier), and the call is synchronous (blocks until done, no `task wait`). Use it when actual motion carryover matters more than staying on the default model; otherwise tail-frame → `first_frame` remains the simpler default for segment handoffs.

```bash
CLI=${CLAUDE_PLUGIN_ROOT}/skills/ironlabs-gen/ironlabs-cli.mjs

# Generate S1
node "$CLI" task generate \
  --prompt "<S1 prompt>" --duration 15 --ratio 16:9
# → rename output to generated/shots/S1.mp4

# Extract tail frame
ffmpeg -sseof -0.2 -i generated/shots/S1.mp4 -frames:v 1 -q:v 2 -y generated/keyframes/S1-end.jpg

# S2 opens exactly where S1 ended
S1_END=$(node "$CLI" material upload generated/keyframes/S1-end.jpg | jq -r '.material.id')
node "$CLI" task generate \
  --prompt "Continuing from the previous shot: <S2 prompt>" \
  --duration 15 --ratio 16:9 \
  --materials "${S1_END}:first_frame"
```

---

## Style Keywords Cheat Sheet

| Category | Example Keywords |
|----------|-----------------|
| Film stock | Kodak Vision3 500T, Fuji Eterna, ARRI LogC, 16mm grain, 35mm anamorphic |
| Black levels | lifted blacks, crushed blacks, milky shadows, deep true blacks |
| Color tone | warm golden palette, desaturated blue-grey, cool undertone in shadows |
| Saturation | desaturated midtones, muted earth tones, oversaturated pop |
| Lighting | golden hour, rim light, volumetric light, natural diffused, motivated practicals |
| Style | documentary, vlog, commercial, Hollywood blockbuster, indie film |
| Animation | 3D CG animation, cel-shaded anime, ink wash painting, pixel art |

**Locking a visual look** — be specific about all four layers:
```
Kodak Vision3 film texture, lifted blacks, cool blue undertone in shadows,
desaturated midtones, warm amber highlights.
```

---

## Technical Parameters — API vs Prompt

**DO NOT put in prompt** (use CLI flags): `--ratio`, `--duration`, `--model`

**DO put in prompt** (visual style): color palette, depth of field, film texture, lighting mood

---
