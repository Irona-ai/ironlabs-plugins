# IronLabs Video Model Capabilities

Model reference only. For prompt writing guidance, see `Read ${CLAUDE_SKILL_DIR}/../director/references/prompt-craft.md`.

## Default Model Specs

| Parameter | Value |
|-----------|-------|
| Default model | `fal-ai/minimax/video-01` |
| Min duration | 5 seconds |
| Max duration | 15 seconds |
| Duration options | Any integer 5–15s |
| Resolution | Up to 1080p |
| Aspect ratios | `16:9`, `9:16`, `1:1`, `4:3`, `3:4` |

Override with `IRONLABS_VIDEO_MODEL` env var or `--model` flag.

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

### Video-to-Video
- Material role: `ref_video`
- Suitable for: motion transfer, style carryover from previous segment

### Best Practices
Default to **Text-to-Video**. Only use reference materials for:
- Pure product photos (no faces) → `ref_image`
- Abstract/landscape references → `ref_image`
- Precise motion replication (no faces) → `ref_video`
- **Human faces** → describe in text only. Do NOT pass face photos as `ref_image`.

---

## Duration Strategy

All video generations use `--duration 15`. This is the fixed unit.

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
| `path:ref_video` (previous segment) | Strong | Motion continuity from previous segment |
| Text-only description | Weak | Nothing locked visually — model may drift |

More anchors = stronger consistency, but longer generation time (8–12 min with multiple anchors vs 5–8 min text-only). Use only what each segment actually needs.

---

## Multi-Segment Continuity

For sequential segments, choose method based on scene goal:

**Use tail-frame → next `first_frame` when:**
- The next segment must open on an exact carried-over pose/composition/state
- You need a clean visual handoff of gaze, props, or lighting

```bash
# Generate S1
bash ${CLAUDE_PLUGIN_ROOT}/skills/ironlabs-gen/scripts/video-gen.sh \
  --prompt "<S1 prompt>" --duration 15 --ratio 16:9

# Extract tail frame
ffmpeg -sseof -0.2 -i generated/shots/S1.mp4 -frames:v 1 -q:v 2 -y generated/keyframes/S1-end.jpg

# S2 opens exactly where S1 ended
bash ${CLAUDE_PLUGIN_ROOT}/skills/ironlabs-gen/scripts/video-gen.sh \
  --prompt "Continuing from the previous shot: <S2 prompt>" \
  --duration 15 --ratio 16:9 \
  --materials "generated/keyframes/S1-end.jpg:first_frame"
```

**Use `ref_video` when:**
- Motion/style carryover matters more than pinning the exact opening frame
- The transition is dynamic and a single extracted still is not enough

```bash
bash ${CLAUDE_PLUGIN_ROOT}/skills/ironlabs-gen/scripts/video-gen.sh \
  --prompt "Continuing from the previous shot: <S2 prompt>" \
  --duration 15 --ratio 16:9 \
  --materials "generated/shots/S1.mp4:ref_video"
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
