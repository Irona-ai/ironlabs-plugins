# Code Review — ironlabs-plugin

> Review of the full branch (`main`). Analysis only — no code was changed.
> Findings are grouped by severity and reference `file:line`.

## Overview

This is the `ironlabs` Claude Code / OpenClaw plugin: a statusLine balance widget
(`src/`), a generation CLI (`skills/ironlabs-gen/ironlabs-cli.mjs`), skill docs,
hooks, and helper scripts.

The code mostly works, but it carries scar tissue from **three rebrands/rewires**
(renoise→ironlabs, Fal→OpenRouter, chat-API→studio-API). The result is a large set
of **doc-vs-code contradictions**, a few **real bugs**, and some **dead code**.
Nothing is catastrophic, but the docs actively misdescribe how the code behaves in
several places.

---

## 🔴 Correctness bugs (will break real usage)

### 1. Documented "text-to-video" is impossible in code
`ironlabs-cli.mjs:255` throws `"Video generation requires a reference image"` when no
`first_frame`/`ref_image` material is passed. But every text-to-video example ships
without materials: `skills/ironlabs-gen/SKILL.md:36-40` ("Text-to-Video — 10s") and
`skills/director/SKILL.md` (Path 1). Any user following the quick-start hits a hard
error. Either support t2v in code, or stop advertising it.

### 2. Balance unit mismatch (cents vs dollars)
The renderer and thresholds treat `balance` as **cents** — `src/render/credits-line.ts:17-18`
(`THRESHOLD_LOW = 500 // $5`), `:26` (`cents/100`). But `src/credits-cache.ts:68-72`
writes `topupBalance` **raw** (`parseFloat`) into that field, and
`ironlabs-cli.mjs:180-182` does the same in `getMe()`. If the Studio API returns
dollars (e.g. `"12.34"`), the status bar shows **$0.12** and the low/zero-balance
logic misfires. This also feeds `hooks/check-api-key.sh:18-22`, which could **block
all generation** on a misparsed balance.

### 3. `credit estimate` fallback models don't exist in the pricing table
`ironlabs-cli.mjs:989-990` falls back to `"black-forest-labs/flux-dev"` /
`"bytedance/seedance-1.5"`, but `OR_PRICING` (`:85-90`) only has `bytedance/seedance-2.0`
etc. Estimating with an unknown model always returns `credits: 0, note: "No pricing data"`.
This block also **duplicates** `estimateCost()` (`:184`) instead of calling it — the two
can drift (and already have).

### 4. `analyze-beats.py` imports `scipy` but doesn't declare it
`skills/director/scripts/analyze-beats.py:45` does `from scipy.signal import find_peaks`,
but the documented install is only `librosa numpy soundfile` (`:14`, `:26`). It crashes
on a clean install. Also `np.round(tempo, 1)` (`:37`) breaks on modern librosa where
`tempo` is an ndarray (`float(array)` throws). The 5–15s constraint also contradicts the
5–10s model limit stated elsewhere.

### 5. `gemini.mjs` silently drops `--temperature`, `--max-tokens`, `--resolution`
All three are parsed (`skills/gemini-gen/scripts/gemini.mjs:113-115`) but never put in
the request body — `callCompletions` only sends `models, messages, stream, conversationId`
(`:225-231`). Setting temperature/max-tokens does nothing. The `...(jsonMode ? {} : {})`
spread at `:230` is a literal no-op.

---

## 🟠 Doc-vs-code contradictions

### 6. FAL vs OpenRouter — docs and code disagree completely
Code routes everything through the **openrouter** connector (`ironlabs-cli.mjs:235`,
`:271`) with OpenRouter model IDs (`x-ai/grok-imagine-video`, `bytedance/seedance-2.0`,
`google/gemini-3.1-flash-image-preview`). But `skills/ironlabs-gen/SKILL.md:25` says the
backend is `POST /api/v1/mcp/fal` (`fal_run`), and its model table (`:56-64`) lists
**FAL** models (`fal-ai/minimax/video-01`, `fal-ai/flux/dev`) that appear nowhere in the
code. The entire model table and every "Fal AI connector" error message are wrong.

### 7. Gemini connector story is contradictory
`skills/gemini-gen/SKILL.md:148` and `gemini.mjs:6` correctly say Gemini runs **natively**
through the Irona gateway ("no OpenRouter connector required"). But `commands/setup.md:153`
and `openclaw.plugin.json:4` tell users gemini-gen needs an **OpenRouter connector**. And
`skills/ironlabs-gen/SKILL.md:129` says material-ingest analyzes "via OpenRouter connector"
— it actually shells out to the native `gemini.mjs`.

### 8. `add-credits.md` hits a different (likely stale) balance endpoint + wrong pricing
`commands/add-credits.md:14` queries `/api/v1/chat/balance`, but the migration commit
moved balance to `studio.ironlabs.ai/api/v1/balance` (used everywhere else). The
subscription table (`:30-34`) — "Exploration/Pro/Enterprise", "Routing Requests",
"$10/million" — is clearly copied from an LLM-router product, not a video-credit product.

### 9. `HELP_CREDIT` says history is "(not available)" but it's implemented
`ironlabs-cli.mjs:650` documents `history (not available)`, yet `creditHistory` /
`getCreditHistory` are fully implemented (`:910`, `:194`) hitting `/chat/transactions`
(which, like #8, may not exist post-migration).

### 10. Version numbers inconsistent across every manifest
`package.json:3` 0.1.0 · marketplace/plugin/openclaw 0.2.0 · ironlabs-gen SKILL 0.1.0 ·
gemini/video/director SKILL 0.3.0. No single source of truth.

### 11. `IRONLABS_STUDIO_URL` is used but documented nowhere
Referenced in `src/credits-cache.ts:60` and `ironlabs-cli.mjs:174`, but absent from the
README env table, `--help`, and setup. Meanwhile `getMe()` and `refreshFromApi` **ignore**
`IRONLABS_BASE_URL`/`--base-url`, so `credit me` against a staging instance silently hits
prod Studio.

### 12. README installation numbering is broken
`README.md:36` — step "3. Launch Claude Code" appears *after* the OpenClaw section, so
under "Claude Code" the steps read 1, 2, … 3-elsewhere.

---

## 🟢 Dead code / unused

- **`skills/ironlabs-gen/scripts/upload.mjs`** — not referenced by any skill, script, or
  doc (confirmed via grep). Its header says it requires `IRONLABS_API_KEY` "for
  authentication context, not used in upload" — demands a key it never uses (`:20-24`).
  Whole file is dead.
- **`client.generate()`** `ironlabs-cli.mjs:331` — defined, never called. Also passes
  `options` to `waitForTask`, which takes no such param (`:305`). `taskGenerate`
  re-implements it inline instead.
- **`index.mjs`** — `export default function register() {}` is a no-op stub wired via
  `package.json` `openclaw.extensions` (`:5-7`). Does nothing.
- **`configSchema.baseUrl`** in `openclaw.plugin.json:10` — never read; code only uses the
  `IRONLABS_BASE_URL` env var.
- **`printResult`** references `result.coverUrl` and `result.warning`
  (`ironlabs-cli.mjs:956-958`) — `coverUrl` is always written `null`, `warning` never set.
- **Cruft comments** describing prior backends: `upload.mjs:8-10`
  ("Backend change: … was: POST https://ironlabs.ai/…").

---

## ⚪ Lower severity / nits

- **`slice()` before `filter()`** in `listLocalTasks:52-57` and `listLocalMaterials:74-80`:
  limit/type filtering is applied *after* truncation, so `--limit N` / `--type video` can
  return fewer than N. Lists are also unsorted (filesystem order, not recency).
- **`Date.now()` as ID** for tasks/materials/assets/characters (`:223`, `:337`, …) —
  collisions overwrite if two are created in the same millisecond (a risk in tight batch loops).
- **Resolution map is lossy/misleading**: `"4k": "1080p"` (`:267`) — asking for 4k silently
  yields 1080p.
- **`download-fallback.sh` filename length differs by OS**: `md5 -q` gives 32 chars on
  macOS, the `md5sum … head -c 12` fallback gives 12 (`:17`) — same URL can dedup-miss across
  platforms. The button/input scraping (`grep -P '@\w+(?=…)'`, `sed -n '2p'`) is very brittle.
- **`credit estimate` / `estimatedCredit` always return 0** (`:250`, `:282`) — cost is never
  surfaced despite the director skill telling you to check budget.

---

## Security notes (low, but worth flagging)

- **Command injection surface** in `skills/ironlabs-gen/scripts/material-ingest.mjs:98-101`:
  `execSync` interpolates `filePath` into a double-quoted shell arg without escaping. A
  filename containing `"` / `$(...)` / backticks executes. The prompt is single-quote-escaped,
  but the path isn't. Prefer `execFileSync(node, [GEMINI_PATH, "--file", filePath, …])`.
- **Arbitrary command execution** in `src/index.ts:44-50`: `runPreviousStatusLine` runs
  whatever command is in `~/.ironlabs/previous-statusline.json` via bash. It's the user's own
  saved config so risk is low, but it's an unguarded `execSync` on every status refresh.

---

## Highest-value fixes, in order

1. Reconcile the **FAL vs OpenRouter** story (#6/#7) — decide the real backend and make code
   + all SKILL model tables agree.
2. Fix the **balance unit** bug (#2) — it silently breaks the headline feature and the
   Bash-blocking hook.
3. Either support **text-to-video** or stop documenting it (#1).
4. Fix **`analyze-beats.py`** deps + tempo handling (#4).
5. Delete the confirmed dead code (`upload.mjs`, `client.generate`, `index.mjs` stub,
   `configSchema.baseUrl`).
