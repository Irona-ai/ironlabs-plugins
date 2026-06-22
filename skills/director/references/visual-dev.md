# Visual Dev — Character & Scene Asset Setup

Quick reference for creating and registering visual assets before writing prompts. Only needed for **multi-clip projects** (>15s) with recurring characters.

---

## When to Use

- Character appears in **2+ segments** → generate a character reference image and pass it as `ref_image`
- Character appears in **1 segment only** → text-only description in prompt is fine
- Scene/environment anchoring → optional but helps consistency

---

## Picking an Image Model

| Use case | Model | Why |
|----------|-------|-----|
| Character design sheet, scene refs, drafts | `fal-ai/flux/dev` | Balanced quality, fast iteration (default) |
| Hero keyframe where fidelity matters | `fal-ai/flux-pro` | Highest fidelity + lighting quality |
| Stylized / painterly illustration | `fal-ai/flux/dev` with style keywords | Add "painterly", "illustration style" to prompt |

Override with `IRONLABS_IMAGE_MODEL` env var, or pass `--model` to `video-gen.sh --image`.

---

## Character Design Sheet

Generate a multi-angle reference for each main character.

**Prompt template:**
```
Character design sheet for [NAME].

[FULL appearance description — age, face details, hair, skin tone, body type,
wardrobe (texture + cut + color per garment), accessories, signature details]

Layout: 2 rows × 3 columns on clean white background.
Row 1: front view (neutral), 3/4 view (neutral), side profile (neutral).
Row 2: front view ([emotion A]), front view ([emotion B]), full body pose.

Concept art style, clean lines, consistent appearance across all panels.
No text labels. No background elements.
```

**Generate:**
```bash
bash ${CLAUDE_PLUGIN_ROOT}/skills/renoise-gen/scripts/video-gen.sh \
  --image --ratio 16:9 \
  --prompt "<character sheet prompt>" \
  --tags "<project>,char-<name>"
# → saved locally, copy to assets/char-<name>.jpg
```

---

## Ingesting User-Provided Materials

If the user provides reference images, product photos, or footage:

```bash
node ${CLAUDE_PLUGIN_ROOT}/skills/renoise-gen/scripts/material-ingest.mjs <paths-or-directory>
```

This analyzes files (tags, descriptions, face detection) and outputs `material-pool.json`. Use `match-materials.mjs` to map pool entries to your shots before generating.

---

## Scene Reference (Recommended for Multi-Clip)

Generate environment-only concept art for each segment to anchor lighting, color palette, and spatial layout. **Without scene refs, different segments will drift in environment appearance even with character refs and ref_video.**

Scene images must NOT contain human faces.

**Generate one scene ref per segment:**
```bash
bash ${CLAUDE_PLUGIN_ROOT}/skills/renoise-gen/scripts/video-gen.sh \
  --image --ratio 16:9 \
  --prompt "<scene description, environment only, no people. Include: location, time of day, lighting, color palette, key props, atmosphere. Photorealistic, cinematic composition.>" \
  --tags "<project>,scene-s<N>"
# → copy output to assets/scene-s<N>.jpg
```

**Scene ref prompt tips:**
- Include exact lighting conditions from your style guide
- Include key props that matter to the story
- Match the color palette to your segment's mood
- If multiple segments share the same location, reuse the same scene ref file

---

## Combining Anchors

Character refs, `ref_video`, `first_frame`, and scene refs combine freely via `--materials`:

```bash
# All anchors (character + continuity + environment)
--materials "assets/char.jpg:ref_image,generated/keyframes/S1-end.jpg:first_frame,generated/shots/S1.mp4:ref_video,assets/scene.jpg:ref_image"

# Character + environment only (no continuity needed — first segment)
--materials "assets/char.jpg:ref_image,assets/scene.jpg:ref_image"

# Environment only (B-roll, no characters)
--materials "assets/scene.jpg:ref_image"
```

**Example workflow for a 3-segment project:**
```
Prep:
  1. Generate character sheet → save to assets/char.jpg
  2. Generate scene concepts in parallel → save to assets/scene-s1.jpg, assets/scene-s2.jpg

Generate (serial chain):
  S1: video-gen.sh --materials "assets/char.jpg:ref_image,assets/scene-s1.jpg:ref_image"
  → ffmpeg extract tail frame → generated/keyframes/S1-end.jpg

  S2: video-gen.sh --materials "assets/char.jpg:ref_image,generated/keyframes/S1-end.jpg:first_frame,generated/shots/S1.mp4:ref_video,assets/scene-s2.jpg:ref_image"
  → ffmpeg extract tail frame → generated/keyframes/S2-end.jpg

  S3: video-gen.sh --materials "assets/char.jpg:ref_image,generated/keyframes/S2-end.jpg:first_frame,generated/shots/S2.mp4:ref_video,assets/scene-s2.jpg:ref_image"
```

S1 has no `ref_video` or `first_frame` — nothing to continue from. Add those anchors only from S2 onward.

> Generations with multiple anchors take 8–12 min/segment.

---

## Storyboard Grid (Recommended for Multi-Clip)

A single image containing key frames from ALL segments. Because the AI renders all panels in one generation, characters share consistent face structure, proportions, and styling across panels.

**Prompt template:**
```
Storyboard grid for "[TITLE]", [N] panels in [R] rows × [C] columns.

[STYLE LINE]

[Full Character Bible for each character — verbatim]

Panel 1 (S1 — [label]): [Key visual moment, 1 sentence. Character action + environment + mood]
Panel 2 (S2 — [label]): [Key visual moment]
...

Consistent character appearance across all panels. Each panel is a distinct scene.
Cinematic composition per panel. No text labels.
```

**Split into individual panels:**
```bash
# Using ImageMagick:
convert storyboard.png -crop 3x2@ +repage +adjoin panel_%d.png

# Or use the included script:
bash ${CLAUDE_SKILL_DIR}/scripts/split-grid.sh storyboard.png output_dir/ 2 3
```

---

## Shot Mapping

Before writing prompts, build a mapping of all anchors for each shot:

```
Shot  Character ref          Scene ref              Prev video / first_frame       --materials
S1    assets/char.jpg        assets/scene-s1.jpg    (none)                         "assets/char.jpg:ref_image,assets/scene-s1.jpg:ref_image"
S2    assets/char.jpg        assets/scene-s2.jpg    S1.mp4 + S1-end.jpg            "assets/char.jpg:ref_image,keyframes/S1-end.jpg:first_frame,shots/S1.mp4:ref_video,assets/scene-s2.jpg:ref_image"
S3    (no characters)        assets/scene-s3.jpg    S2.mp4 + S2-end.jpg            "keyframes/S2-end.jpg:first_frame,shots/S2.mp4:ref_video,assets/scene-s3.jpg:ref_image"
```

**Rules:**
- Scene/environment images (no faces) → `path:ref_image`
- Previous segment tail frame → `path:first_frame`
- Previous segment video → `path:ref_video`
- Same location across segments → reuse the same scene ref file
- S1 has no `ref_video` or `first_frame`
