# Prompt Craft - Writing High-Density Video Prompts

This is the most important reference in the director skill. **The quality of the video is determined by the quality of the prompt.** Everything else (pipeline, asset setup, assembly) is infrastructure.

---

## The Core Principle

**Write like a director dictating on set, not like a screenwriter summarizing a scene.**

Bad: "She picks up a thermos and places it on the pedestal. He looks at it skeptically."

Good: "She reaches into the case. Pulls out a large industrial thermos - silver, cylindrical, 40 centimeters tall. She holds it up. Tilts her head. Squints. She hands it to him with the energy of someone presenting a solution. He receives it. Holds it at arm's length. Looks at it. Looks at the pedestal - which requires something approximately three times larger and entirely decorative."

The model responds to **specificity and physical detail**. Every action should have a visible physical result. Every object should have material, size, and color. Every gesture should have intention.

---

## Prompt Structure

### 1. Style & Camera Foundation (2-3 lines)

Persistent visual DNA. Film stock, lens, grade, aspect ratio. This stays **identical across all segments** of a multi-clip project.

```
Cinematic 16:9 widescreen. Shot on ARRI Alexa 65, Cooke vintage cinema lenses.
35mm film grain, Kodak Vision3 500T grade - bleached desert, blown-out sky, brutal noon heat.
Hyperrealistic skin, zero retouching. Hard overhead sun, ink-black shadows.
```

Not a checklist - a **visual world declaration**.

### 2. Characters (full block per character)

Each character gets: **identity lock + appearance + wardrobe + narrative function + behavioral pattern**.

```
[CHARACTER: PROP SOURCER] Female, identity lock.
Utility vest, all pockets stuffed with visibly wrong items, clipboard permanently in hand.
She was responsible for bringing the props. She brought everything except the correct one.
She has an explanation for this. She always has an explanation for this.
```

For multi-clip: copy the **entire character block verbatim** into every segment prompt. Never abbreviate.

### 3. Key Props & Environment (if important to the story)

```
THE PROP: One large decorative vase. Tall, ornate, needed on the pedestal for the shot.
It is not here. It was never here. Everything that follows is a consequence of this single fact.

THE PEDESTAL: Center frame, background. Empty. Visible in almost every shot.
```

### 4. Genre Engine (optional but powerful)

```
[COMEDY ENGINE]
The structure is a ratchet - each cycle tightens one notch:
Wrong prop attempted → fails on set → blame exchanged → next wrong prop → fails worse → more blame.
```

Other examples:
- **Suspense**: "Each shot reveals one more piece of evidence. The audience should know something the character doesn't."
- **Romance**: "Push and pull - every approach is followed by a retreat. The distance between them shrinks by inches."
- **Product reveal**: "Build anticipation by showing the problem three times before the solution enters frame."

### 5. Timeline - Action-by-Action (the body of the prompt)

**For single clips (≤15s): use 1-2 second granularity.**
**For multi-clip segments: use 2-3 second granularity minimum.**

Never use the 5-second blocks `[0-5s] [5-10s] [10-15s]` as your primary structure — they're too coarse.

Each beat should contain:
- **Who** does **what** (specific physical action)
- **How** it looks (object details, spatial relationships)
- **What happens** as a result (physical consequence, reaction)

### 6. Sound Design (per-segment, not a footnote)

**Bad:**
```
Sound design: desert ambient, SFX.
```

**Good (per-beat sound layer):**
```
Sound: thermos placed on pedestal - a hollow metal ring - silence - footsteps returning -
thermos placed back into hands - another hollow ring.
```

Write sound for **each timeline segment**. Layer ambient + action SFX + character sounds. Name specific materials and their acoustic properties.

### 7. Realism & Stability Lock (closing block)

```
[REALISM LOCK]
Prop physics: thermos rings on pedestal accurately, cone construction topples
with realistic wind physics and material cascade.
Female character — zero identity drift. Vest pockets depleting continuously.
Male character — zero identity drift. Gaffer tape roll visibly smaller across takes.
No music. No voiceover. No subtitles. No text. Diegetic audio only.
16:9 enforced. No glitches, no floating objects, no duplicated limbs.
```

---

## Referencing Materials in Prompts

When you attach reference images as `--materials`, describe them in the prompt so the model knows which image maps to which character or object.

```bash
bash ${CLAUDE_PLUGIN_ROOT}/skills/renoise-gen/scripts/video-gen.sh \
  --prompt "<prompt>" --duration 15 --ratio 16:9 \
  --materials "assets/char-woman.jpg:ref_image,assets/scene-hallway.jpg:ref_image"
```

In the prompt, describe each material by its role:

```
[CHARACTER] — see attached character reference image.
Female, identity lock. Utility vest, clipboard in hand...

[SCENE] — see attached scene reference image.
Dimly lit apartment hallway, warm pendant light overhead...
```

---

## Multi-Clip: Structure & Continuity

### Narrative Arc Templates

- **30s (2 segments)**: S1 = hook + setup, S2 = escalation + payoff
- **45s (3 segments)**: S1 = setup + inciting incident, S2 = rising complications, S3 = climax + resolution
- **60s (4 segments)**: S1 = hook, S2 = development, S3 = climax, S4 = resolution/coda

### Transition Types Between Segments

| Transition | Technique | When to Use |
|------------|-----------|-------------|
| **Action Bridge** | End mid-action → next segment continues the motion | Physical movement, chase, dance |
| **Gaze Lead** | Character looks toward something → next segment reveals it | Mystery, discovery |
| **Sound Bridge** | Next scene's ambient sound bleeds into current ending | Location changes |
| **Match Cut** | Similar shape/color/motion links two different shots | Thematic connections |
| **Emotional Shift** | Abrupt mood change (quiet→loud or loud→quiet) | Surprises, twists |

### Serial continuity: choose based on scene goal

**Use tail-frame → next `first_frame` when:**
- The next shot must open on an exact composition from the previous shot

```bash
ffmpeg -sseof -0.2 -i generated/shots/S1.mp4 -frames:v 1 -q:v 2 -y generated/keyframes/S1-end.jpg
# then pass: --materials "generated/keyframes/S1-end.jpg:first_frame"
```

**Use `ref_video` when:**
- Motion/style transfer matters more than pinning the next shot's exact opening frame

```bash
# pass: --materials "generated/shots/S1.mp4:ref_video"
```

### Same style line everywhere
Copy your style foundation block (Section 1) identically into every segment.

### Full character block everywhere
Copy the entire character description verbatim into every segment. Never abbreviate.

#### Drift vulnerability ranking

1. **Hair color & length** - most volatile. Always specify shade, length, texture.
2. **Skin tone** - use specific terms ("warm ivory", "deep espresso brown"), not vague ("light", "dark").
3. **Clothing color** - must include texture + cut + color: "oversized cream-colored chunky-knit wool cardigan" not "white sweater".
4. **Age** - state explicitly: "late 20s" not "young woman".

#### Wardrobe three-part formula
Every garment: `[texture/material] + [cut/style] + [color]`

Accessories and unique features act as visual anchors — include in every prompt.

### Bridge formula
Every segment after S1 must start with:
```
Continuing from the previous shot: [exact ending state of previous segment —
character position, prop state, emotional state, lighting state].
```

### Hiding inevitable inconsistency
- **Whip pan / motion blur** at segment boundaries hides appearance jumps
- **Close-up → Wide** scale change between segments masks small differences
- **Cut on action** — the viewer follows the action, not appearance
- **Cross-dissolve** (0.3-0.5s) in post-production softens visual jumps

---

## What NOT to Do

- **Don't write generic actions**: "She interacts with the object" → write exactly what she does with her hands
- **Don't summarize**: "They argue about whose fault it is" → write the specific pointing gestures, clipboard grabs, stepping patterns
- **Don't front-load camera instructions**: action first, camera second
- **Don't skip sound design**: every silent prompt is a wasted opportunity to improve the visual output
- **Don't put BGM instructions for narrative videos**: BGM instructions are for e-commerce/product videos only

---

## Complete Single-Clip Example

```
Cinematic 16:9 widescreen. Shot on ARRI Alexa 65, Cooke vintage cinema lenses.
35mm film grain, Kodak Vision3 500T grade - bleached desert, blown-out sky, brutal noon heat.
Hyperrealistic skin, zero retouching. Hard overhead sun, ink-black shadows.
Motion blur on all fast prop handling, gestures, reactive stumbles.

[CHARACTER: PROP SOURCER] Female, identity lock. Utility vest, all pockets stuffed
with visibly wrong items, clipboard permanently in hand. She was responsible for bringing
the props. She brought everything except the correct one. She has an explanation for this.

[CHARACTER: PROP EXECUTOR] Male, identity lock. Matching utility vest, tool belt,
walkie-talkie on shoulder. He receives what she gives him and makes it work on set.
Nothing she gives him works.

THE PROP: One large decorative vase. Tall, ornate, needed on the pedestal for the shot.
It is not here.
THE PEDESTAL: Center frame, background. Empty. Visible in almost every shot.

[COMEDY ENGINE]
The structure is a ratchet - each cycle tightens one notch:
Wrong prop attempted → fails on set → blame exchanged → next wrong prop → fails worse.

[TIMELINE]
0-2s: Wide shot. Desert. The pedestal. Empty.
He walks toward it from frame right — hands out, ready to receive the vase.
Stops. Looks at the empty pedestal. Turns slowly toward her.
She is at her prop cases — three large cases open on the cracked earth.
Looking at her clipboard. Then at the cases. Then at the clipboard again.

2-4s: She reaches into a case. Pulls out a large industrial thermos - silver,
cylindrical, 40 centimeters tall. Holds it up. Tilts her head. Squints.
Hands it to him with the energy of someone presenting a solution.
He receives it. Holds it at arm's length. Looks at the pedestal —
which requires something approximately three times larger.
Walks it to the pedestal. Places it. Steps back.
The thermos sits on the pedestal — tiny, silver, obviously a thermos.
A beat. Both stare at it.

4-6s: He points at the cases. His gesture: where is the actual vase.
She points at her clipboard. Her gesture: it was on the list.
He takes the clipboard. Points at a line. She takes it back. Points at a different line.
Neither has moved toward a solution. The pedestal is still empty in the background.

6-8s: She pulls two traffic cones from the case. Stacks them inverted on each other.
Wraps them in a silver reflector sheet. Tapes it.
She presents it with full confidence.
He carries it to the pedestal. Places it. Steps back.
A gust of wind hits. The construction rotates slowly — then topples sideways.
He watches it fall. Turns to her. She is already writing on her clipboard.

8-10s: Both working now — simultaneously, not communicating.
She stacks a hard hat on the thermos, wraps in reflector material.
He tapes three water bottles together, adds a funnel for an ornate top.
They finish at the same time. Swap — without speaking. Still wrong.
He begins taping her construction to his. She watches. Then helps.

10-12s: They carry it together to the pedestal. Place it. Step back. It holds.
She opens her clipboard. Points to the original vase on the list.
He points at the confirmation field — which shows his signature.
The clipboard between them like a net, neither able to let go.

12-15s: Wide shot. The walkie-talkie crackles. Director's voice — shot cancelled.
Neither of them moves. She points at the clipboard. He points at her.
Extreme wide shot — the desert vast, the production leaving in soft-focus background,
two figures in the mid-ground still pointing, the argument continuing into the empty desert.
The crew is gone. They are still there. Cut to black.

[SOUND DESIGN]
0-2s: Desert wind, footsteps on cracked earth, clipboard pages turning.
2-4s: Thermos placed on pedestal — hollow metal ring — silence — footsteps back.
4-6s: Clipboard changing hands, pages flipping, two sets of pointing gestures cutting air.
6-8s: Reflector sheet wrapping, tape ripping, wind hitting construction, slow rotation,
collapse — plastic on earth, reflector crumpling, tape releasing, pen on paper.
8-10s: Rapid assembly — tape, plastic, metal, foil — the swap — reluctant sync.
10-12s: Paper tension sound, fingers gripping clipboard, neither releasing, desert wind.
12-15s: Walkie-talkie crackle, vehicle engines receding, wind picking up,
two voices still arguing — not angry, just automatic — fading into black.

[REALISM LOCK]
Female character — zero identity drift. Vest pockets depleting continuously.
Male character — zero identity drift. Gaffer tape roll visibly smaller.
Prop physics: thermos rings accurately, cone construction topples with realistic wind physics.
Clipboard: same physical object throughout, edges worn by end.
No music. No voiceover. No subtitles. No text. Diegetic audio only.
16:9 enforced. No glitches, no floating objects, no duplicated limbs.
```
