# Full Example: Keep Resistance Loop Bands — 15s E-commerce Video

## Input

- Product image: `product.jpg` — Keep brand resistance loop bands, 3-pack (pink/blue/green), pastel macaron colors
- Model reference: Athletic female, blonde ponytail, sports bra + fitted shorts (for analysis only, NOT passed to generation)

## Step 1 — Product Analysis

```bash
node ${CLAUDE_PLUGIN_ROOT}/skills/gemini-gen/scripts/gemini.mjs \
  --file product.jpg --mode product
```

### Result

```json
{
  "product": {
    "type": "Resistance loop bands",
    "color": "Pink 10lb, Blue 15lb, Mint green 20lb",
    "material": "TPE elastic, matte finish, soft and skin-friendly",
    "highlights": "Three bands with progressive resistance for training, foldable and portable, pastel macaron color scheme",
    "brand_tone": "Youthful athletic, trendy fitness"
  },
  "scene_suggestions": [
    "Bright modern living room morning workout",
    "Hotel room travel fitness",
    "Bedroom bedtime stretching"
  ],
  "selling_points": [
    "Three resistance levels for progressive training, suitable for beginners to advanced",
    "Compact and portable, folds to fit in a bag for anytime/anywhere workouts",
    "Pastel macaron color scheme, won't roll up during use"
  ]
}
```

## Step 2 — Generated Script

### Video Prompt (English, with dialogue)

> The product is a set of three Keep brand elastic resistance loop bands — flat, wide, smooth matte TPE material with a soft rubbery texture, each band approximately 5cm wide and forming a closed loop. Colors: pastel pink (lightest resistance), sky blue (medium), mint green (heaviest). Each band has a small white "Keep" logo printed on the surface. The bands must match the reference image exactly in color, width, shape, material finish, and logo placement throughout every frame of the video. A fit young woman in her mid-twenties with blonde hair in a high ponytail, light tan skin, athletic build, wearing a black sports bra and black fitted shorts, holds the three pastel-colored Keep resistance bands fanned out in her hand — camera starts extreme close-up on the bands showing their flat wide shape and matte surface then whip pans up to her face as she says "Stop scrolling — I threw out all my gym equipment for these three bands." Morning sunlight from a large window catches the smooth TPE finish. Camera does a fast snap dolly in on her hands as she stretches the blue band taut, the flat wide band maintaining its shape and thickness as it stretches, she says "Ten, fifteen, twenty pounds — I started pink, now I am on green, and they never roll up on you." She has the mint green band already looped around both ankles, camera pulls back to medium shot as she performs side leg raises, the wide flat band visible around her ankles keeping its shape, she says "I do legs in my living room, arms on work trips — they fold smaller than my phone" while transitioning into a squat pulse with the pink band above her knees. Without stopping she grabs all three bands, folds them into a tiny square and tucks them into a small gym bag pocket, camera pushes in tight, then she looks straight into the camera with a knowing grin and says "Honestly the best forty bucks I have spent this year," the pastel colors pop against her black outfit, warm golden backlight creates a soft halo, frame holds steady.

### Dialogue Script

```
[0-3s]   "Stop scrolling — I threw out all my gym equipment for these three bands."
[3-8s]   "Ten, fifteen, twenty pounds — I started pink, now I'm on green, and they never roll up on you."
[8-12s]  "I do legs in my living room, arms on work trips — they fold smaller than my phone."
[12-15s] "Honestly the best forty bucks I've spent this year."
```

### BGM / Sound Design

- **BGM**: High-energy trap-pop beat, BPM 125-135, bass drop synced with the 0s hook
- **Sound effects**:
  - [0s] Band snap/recoil sound — paired with opening impact
  - [3s] Fast whoosh transition
  - [8s] Workout rhythm drum accent
  - [12s] Bass swell + freeze-frame hit

## Step 3 — Generate

```bash
# Check balance before generating
curl -s "${IRONLABS_BASE_URL:-https://chat.irona.ai}/api/v1/chat/balance" \
  -H "Authorization: Bearer $IRONLABS_API_KEY" | jq '.balance'

# Generate — product image passed as local file path (embedded as base64)
bash ${CLAUDE_PLUGIN_ROOT}/skills/renoise-gen/scripts/video-gen.sh \
  --prompt "<Video Prompt above>" \
  --duration 15 --ratio 9:16 \
  --materials "product.jpg:ref_image" \
  --tags "ecom,keep,resistance-band"
```

## Multi-Scene Batch Generation

Reuse the same product image for multiple scenes by swapping dialogue and environment keywords:

| Scene | Hook Dialogue | Scene Keywords |
|-------|--------------|----------------|
| Outdoor park morning workout | "This tiny thing replaced my entire gym bag." | sunlit park lawn, golden hour, dewy grass |
| Hotel room travel fitness | "Business trip day three and I still have not skipped a workout." | hotel room, city skyline, suitcase |
| Bedroom bedtime stretching | "My nighttime routine that actually changed my body." | cozy bedroom, string lights, yoga mat |

```bash
# Create shots.json
cat > shots.json << 'EOF'
[
  {
    "shot_id": "S1",
    "prompt": "<outdoor scene prompt>",
    "duration": 15,
    "materials": "product.jpg:ref_image"
  },
  {
    "shot_id": "S2",
    "prompt": "<hotel scene prompt>",
    "duration": 15,
    "materials": "product.jpg:ref_image"
  },
  {
    "shot_id": "S3",
    "prompt": "<bedroom scene prompt>",
    "duration": 15,
    "materials": "product.jpg:ref_image"
  }
]
EOF

bash ${CLAUDE_PLUGIN_ROOT}/skills/director/scripts/batch-generate.sh \
  --prompts-file shots.json --ratio 9:16 --project keep-bands
```
