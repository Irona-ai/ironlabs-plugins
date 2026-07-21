# E-commerce Video Prompt Guide

For TikTok / short-form product videos. Read `prompt-craft.md` first for general prompt writing — this guide covers e-commerce-specific techniques.

---

## Structure: One Continuous 15s Shot

E-commerce videos are **one continuous shot** with camera movement changes to showcase the product and model. Not rapid-cut montage.

```
[0-3s]   HOOK — Product in Frame 1 + fast camera + start speaking immediately
[3-8s]   SHOWCASE — Product close-up + material details + model interaction
[8-12s]  SCENE — Lifestyle scenario + usage + atmosphere
[12-15s] CLOSE — Face camera + product in frame + frame holds steady
```

---

## Product Anchoring (Start of Prompt)

Product appearance comes from the reference image. The prompt needs only **one sentence**:

```
The product is a [brand] [product type] for [primary use case], shown in the reference image.
The product must match the reference image exactly in every frame.
Do not invent any packaging, box, or container unless the reference image shows one.
```

Do NOT describe product color/material/shape in the prompt — that's in the reference image. Save prompt space for the narrative.

---

## Model Description (Text-Only)

Never upload real person photos (privacy detection blocks them). Describe the model entirely in text:

```
A 25-year-old woman with blonde hair in a high ponytail, light tan skin, athletic build,
wearing a black sports bra and black fitted shorts...
```

---

## The First 3 Seconds (Hook)

63% of high-CTR TikTok videos capture users in the first 3 seconds. The "watch or swipe" decision happens in 1.7 seconds.

**Rules:**
1. Product **must** appear in Frame 1 — never start with someone walking or establishing the environment
2. Frame 1 **must** have motion — static opening = instant swipe
3. Model **must** start speaking within the first 2 seconds

**Visual hook techniques:**

| Technique | Prompt Phrasing |
|-----------|----------------|
| Snap zoom-in | `Camera snaps in extreme close-up on the [product]` |
| Hand thrust | `A hand thrusts the [product] toward the camera` |
| Whip pan | `Camera whip-pans with motion blur and lands on the [product]` |
| Close → wide reveal | `Extreme macro on [texture detail], camera rapidly pulls back to reveal...` |

**Hook dialogue formulas (ranked by effectiveness):**
1. Result-first: "This $30 bag replaced my gym bag AND my purse."
2. Subversive: "Stop carrying two bags to the gym — you only need this one."
3. Social proof: "200K people bought this last month and I finally get why."
4. Pain point: "Why is your gym bag always so heavy?"

---

## Dialogue Guidelines

Best-friend casual tone — recommending to a friend, not reading ad copy. Every sentence carries specific information (numbers, comparisons, scenarios).

```
[0-3s]   Hook: "Stop scrolling — I threw out all my gym equipment for these three bands."
[3-8s]   Specs: "Ten, fifteen, twenty pounds — I started pink, now I'm on green, and they never roll up."
[8-12s]  Scenes: "I do legs in my living room, arms on work trips — they fold smaller than my phone."
[12-15s] Close: "Honestly the best forty bucks I've spent this year."
```

**Closing lines — natural, no hard sell:**
- "Trust me just start — future you will be so grateful."
- "Best thing I ever packed."
- "You're welcome."

**Avoid**: "Link below", "limited stock", "click now" — too pushy.

**Format in prompt:**
```
Spoken dialogue (say EXACTLY, word-for-word): "Stop scrolling — I threw out all my gym equipment for these three bands."
Mouth clearly visible when speaking, lip-sync aligned.
```

---

## Physical Continuity Rule

The model cannot generate implicit state transitions — it teleports between states (cap on → product applied; sealed bag → open; folded clothing → worn). Any product moving from **packaged/stored state** to **in-use state** must use one of two strategies:

- **Skip the transition**: begin the timeline with the product already in its in-use state. Never mention the packaged state in the same or adjacent time segment.
- **Make it explicit**: dedicate a separate time segment to the preparation action ("model unscrews the cap and sets it aside"), then start the demo in the next segment.

Applies to any packaging: bottle caps, sealed pouches, cardboard boxes, clothing tags, zip-lock bags, foil wrappers, shoe boxes.

## Action Granularity Rule

Never compress a multi-step physical process into one sentence — the model renders a single sentence as a single instantaneous event.

**Minimum 3 sub-steps per demo action**, each on its own sentence, each describing the **mid-action / incomplete state** — not the end state:

| ❌ Compressed (avoid) | ✅ Granular (target) |
|---|---|
| "pumps foundation onto cheek and blends it in" | ① A small pump of product lands on the cheekbone. ② One fingertip gently taps the center — product not yet spread. ③ Slow outward circles; edges still unblended at the frame edge. |
| "rubs the serum onto her arm and it absorbs" | ① Drops serum onto the back of the hand, lets it pool. ② Fingertip spreads it across half the skin — other half still bare. ③ Presses palm flat; skin slowly drinks it in. |
| "tries on the jacket and zips it up" | ① Slides one arm in, sleeve hanging loose. ② Pulls the other side across the chest, fabric slightly bunched. ③ Zipper drawn up slowly, jacket settling into shape. |

Add pace qualifiers to each sub-step: *slowly*, *gently*, *just barely*, *one corner at a time*. Give the model a continuous journey, not a jump cut.

---

## Camera Pacing

```
[0-3s]   Fast: extreme close-up snap / whip pan. Complete first camera change in 1-2s.
[3-8s]   Medium: snap dolly on details, orbit to reveal texture.
[8-12s]  Pull back: medium/wide shot, model interacts with environment.
[12-15s] Settle: camera pushes in tight then holds. Frame holds steady.
```

---

## BGM

Always add a BGM instruction at the end of e-commerce prompts:

```
Background music: [genre/mood], [tempo], [energy level].
```

| Category | BGM |
|----------|-----|
| Sports/Fitness | `upbeat electronic lo-fi, medium-fast, energetic and motivating` |
| Beauty/Skincare | `warm chill R&B, slow-medium, soft and intimate` |
| Electronics | `clean minimal electronic, medium, modern and sleek` |
| Fashion | `trendy indie pop, medium, stylish and confident` |
| Home | `warm acoustic guitar, slow, cozy and relaxing` |

---

## Category Keywords

**Clothing**: flowing silk, crisp cotton, fabric sways gently, hem flutters, twirls to show volume
**Electronics**: anodized aluminum, screen illuminates face, finger glides across display, rotates to reveal thin profile
**Beauty**: dewy finish, velvety matte, applies with brush stroke, blends with fingertip
**Food**: steam rises, sauce glistens, crispy golden crust, cheese stretches, slow-motion pour
**Home**: warm wood grain, soft linen texture, hand caresses surface, opens drawer smoothly

---

## Generation

```bash
CLI=${CLAUDE_PLUGIN_ROOT}/skills/ironlabs-gen/ironlabs-cli.mjs

# Analyze product image first
node ${CLAUDE_PLUGIN_ROOT}/skills/gemini-gen/scripts/gemini.mjs \
  --file product.jpg --mode product

# Upload the product image, then generate
PRODUCT=$(node "$CLI" material upload product.jpg | jq -r '.material.id')
node "$CLI" task generate \
  --prompt "<prompt>" \
  --duration 15 --ratio 9:16 \
  --materials "${PRODUCT}:ref_image" \
  --tags "ecom,<brand>"
```

Note: e-commerce videos typically use **9:16** (vertical) ratio, not 16:9.
