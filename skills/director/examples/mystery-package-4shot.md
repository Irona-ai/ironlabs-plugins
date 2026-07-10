# Example: Mystery Package — 4-Shot Short Film

A complete walkthrough of the 6-phase workflow for a 45-second suspense short film.

## Phase 1 — Story & Character Bible

### Story Concept
Maya comes home to find a mysterious package at her door. Inside is an antique pocket watch that glows when she holds it. As she examines it, the watch hands start spinning backwards and the room fills with golden light.

### Story Structure
- **Beginning** (8s): Maya discovers the package
- **Development** (13s): She opens it, finds the watch
- **Climax** (12s): The watch activates, supernatural event
- **Resolution** (12s): Aftermath, sense of wonder

### Character Bible

```json
[
  {
    "id": "CHAR_MAYA",
    "name": "Maya",
    "appearance": "East Asian woman, late 20s, shoulder-length black hair with subtle auburn highlights, warm ivory skin, almond-shaped dark brown eyes, slim build",
    "wardrobe": "Oversized cream-colored chunky-knit wool cardigan over a fitted charcoal cotton turtleneck, high-waisted dark indigo straight-leg jeans, brown leather ankle boots",
    "signature_details": "Small gold hoop earrings, thin gold chain bracelet on left wrist, no rings"
  }
]
```

### Style Guide

```json
{
  "visual_style": "Cinematic suspense drama, shallow depth of field, subtle film grain, anamorphic lens flares",
  "color_palette": "Warm amber tones with cool blue shadows, muted saturation shifting to warm gold in climax",
  "lighting": "Soft golden hour side-lighting through large windows, practical lamps as warm fill, cool blue ambient from hallway",
  "negative_prompts": "No cartoon, no anime, no oversaturated colors, no dutch angles, no text overlays, no watermarks, no horror, no jump scares"
}
```

## Phase 2 — Music & Beat Analysis

### Finalized Shot Durations
- S1: 8s (intro)
- S2: 13s (verse)
- S3: 12s (chorus)
- S4: 12s (outro)

## Phase 3 — Shot Table

### S1 — Discovery (8s)

| Field | Value |
|-------|-------|
| scene | Dimly lit apartment hallway, warm overhead pendant light, beige walls |
| action | Maya walks down hallway carrying grocery bags, notices a small wrapped package on her doormat, picks it up |
| camera | [0-3s] Medium tracking shot from behind. [3-5s] Over-shoulder as she sets bags down. [5-8s] Slow push-in to her hands and face. |
| continuity_out | Standing at apartment doorway, both hands holding small wrapped package at chest height, curious expression |

### S2 — The Watch (13s)

| Field | Value |
|-------|-------|
| scene | Maya's apartment living room, warm table lamp on wooden desk, large window with twilight blue light |
| action | Maya unwraps the brown paper to reveal a worn velvet box, opens it to find an ornate gold pocket watch, lifts it out, holds it up to the lamp light |
| continuity_in | Standing at apartment doorway, both hands holding small wrapped package at chest height |
| continuity_out | Seated at wooden desk, right hand holding gold pocket watch up at eye level, expression of quiet wonder |

### S3 — Activation (12s)

| Field | Value |
|-------|-------|
| scene | Same apartment living room, lighting shifts — the gold pocket watch begins emitting a warm golden glow |
| action | Watch hands begin spinning backwards rapidly, golden light emanates, light particles float upward, Maya's eyes widen in fascination |
| continuity_in | Seated at wooden desk, right hand holding gold pocket watch up at eye level |
| continuity_out | Standing up from desk, both hands cupping the glowing watch, room bathed in warm golden light, expression of awe |

### S4 — Wonder (12s)

| Field | Value |
|-------|-------|
| scene | Apartment living room, golden light slowly fading back to warm amber, particles settling like golden dust |
| action | Maya slowly lowers the watch, golden light fades to a gentle pulse, she places watch on the desk, steps back, smiles with wonder |
| continuity_in | Standing up from desk, both hands cupping the glowing watch, room bathed in golden light |
| continuity_out | Standing 2 steps back from desk, watch pulsing gently on desk, expression of wonder |

## Phase 4 — Generation (Serial Chain)

```bash
# Check balance
curl -s "${IRONLABS_BASE_URL:-https://www.chat.ironlabs.ai}/api/v1/chat/balance" \
  -H "Authorization: Bearer $IRONLABS_API_KEY" | jq '.balance'

# S1 — character ref + scene ref (no ref_video for first segment)
bash ${CLAUDE_PLUGIN_ROOT}/skills/ironlabs-gen/scripts/video-gen.sh \
  --prompt "<S1 prompt>" --duration 8 --ratio 16:9 \
  --materials "assets/maya-ref.jpg:ref_image,assets/scene-hallway.jpg:ref_image" \
  --tags "mystery,s1"
# → rename output to generated/shots/S1.mp4

# Extract tail frame from S1 to anchor S2's opening
ffmpeg -sseof -0.2 -i generated/shots/S1.mp4 -frames:v 1 -q:v 2 -y generated/keyframes/S1-end.jpg

# S2
bash ${CLAUDE_PLUGIN_ROOT}/skills/ironlabs-gen/scripts/video-gen.sh \
  --prompt "<S2 prompt>" --duration 13 --ratio 16:9 \
  --materials "assets/maya-ref.jpg:ref_image,generated/keyframes/S1-end.jpg:first_frame,generated/shots/S1.mp4:ref_video,assets/scene-living.jpg:ref_image" \
  --tags "mystery,s2"
# → rename output to generated/shots/S2.mp4

ffmpeg -sseof -0.2 -i generated/shots/S2.mp4 -frames:v 1 -q:v 2 -y generated/keyframes/S2-end.jpg

# S3
bash ${CLAUDE_PLUGIN_ROOT}/skills/ironlabs-gen/scripts/video-gen.sh \
  --prompt "<S3 prompt>" --duration 12 --ratio 16:9 \
  --materials "assets/maya-ref.jpg:ref_image,generated/keyframes/S2-end.jpg:first_frame,generated/shots/S2.mp4:ref_video,assets/scene-living.jpg:ref_image" \
  --tags "mystery,s3"
# → rename output to generated/shots/S3.mp4

ffmpeg -sseof -0.2 -i generated/shots/S3.mp4 -frames:v 1 -q:v 2 -y generated/keyframes/S3-end.jpg

# S4
bash ${CLAUDE_PLUGIN_ROOT}/skills/ironlabs-gen/scripts/video-gen.sh \
  --prompt "<S4 prompt>" --duration 12 --ratio 16:9 \
  --materials "assets/maya-ref.jpg:ref_image,generated/keyframes/S3-end.jpg:first_frame,generated/shots/S3.mp4:ref_video,assets/scene-living.jpg:ref_image" \
  --tags "mystery,s4"
# → rename output to generated/shots/S4.mp4
```

> Multi-anchor generations take ~8–12 minutes per segment. Generate one shot at a time and verify continuity before proceeding to the next.

## Phase 5 — Assembly

```bash
cd generated/shots

# Concatenate clips
printf "file '%s'\n" S1.mp4 S2.mp4 S3.mp4 S4.mp4 > concat.txt
ffmpeg -y -f concat -safe 0 -i concat.txt -c copy final-silent.mp4

# Add BGM
ffmpeg -i final-silent.mp4 -i ../../bgm.mp3 -c:v copy -c:a aac -shortest final.mp4
```
