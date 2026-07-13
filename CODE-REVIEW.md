# Code Review — ironlabs-plugin

> Review of branch `add-claude-review` vs `main`. Analysis only — no code was changed.
> Every finding below was verified against the **current** code (tsc, `node --check`,
> grep), not inferred from the diff. Findings reference `file:line`.

## Overview

This is the `ironlabs` Claude Code / OpenClaw plugin: a statusLine balance widget
(`src/`), a generation CLI (`skills/ironlabs-gen/ironlabs-cli.mjs`), skill docs,
hooks, and helper scripts.

The previous version of this file described a set of bugs (text-to-video, command
injection, unsorted lists, FAL/OpenRouter contradictions, etc.) that were **already
fixed** in commit `ffe6c76` (`claude-code-fixes`). That fix pass, however, **botched
two edits** in the balance dollars→cents refactor and shipped the two headline
features — the statusLine and `credit me` — broken. Those two regressions are the
main story of this branch and are listed first.

---

## 🔴 Show-stoppers (introduced by the balance refactor — fix before merge)

### 1. `src/credits-cache.ts` does not compile — stray closing brace
`src/credits-cache.ts:80` has an extra `}` (the `refreshFromApi` body closes at `:79`).
Verified:
- `npx tsc --noEmit` → `src/credits-cache.ts(80,1): error TS1128: Declaration or statement expected.`
- brace balance for the file is `-1`.

The statusLine is invoked directly as `… src/index.ts` via tsx/node
(`commands/setup.md:93-98`), and `index.ts` imports `credits-cache.js`. The module
fails to parse, so `index.ts` never loads and `main().catch()` never runs — **the
balance widget renders nothing on every refresh.** The mangled indentation from
`:67` down is the tell that this was a bad hand-edit.

**Fix:** delete the extra `}` at `:80`.

### 2. `ironlabs-cli.mjs` `getMe()` references an undefined variable `raw`
`skills/ironlabs-gen/ironlabs-cli.mjs:195-209`:
```js
const data = await this.request("GET", "/chat/balance");
if (raw == null) {              // ← `raw` is never declared
```
The assignment `const raw = data.data?.totalBalance ?? data.balance` was dropped.
`raw` is read at `:197` and `:201` but grep confirms it is never assigned. The file
passes `node --check` (it's a valid reference syntactically) but throws
`ReferenceError: raw is not defined` at runtime. It is not an `ApiError`, so it
escapes to `throw e` at `:1112` → uncaught stack trace. **`credit me` is completely
broken**, and any code path that calls `getMe()` fails.

**Fix:** add `const raw = data.data?.totalBalance ?? data.balance;` before `:197`.

> Both bugs are the *same* refactor (normalize balance to cents) applied twice and
> fumbled both times.

---

## 🟠 Stale references left by the migration

### 3. `match-materials.mjs` output is incompatible with the current CLI
The workflow migrated from `video-gen.sh --materials "path:role"` to uploaded material
**IDs** (`task generate --materials "194:ref_image"`). But
`skills/ironlabs-gen/scripts/match-materials.mjs:97-124` still emits **localPath**-based
flags (`assets/char.jpg:ref_image`), and its header comment (`:17`) references the
now-deleted `video-gen.sh`. Fed to the CLI, `buildCreateParams` does
`parseInt("assets/char.jpg")` → `NaN` → `readMaterial(NaN)` → null → **the material is
silently dropped**. This script is referenced live from `SKILL.md` and `visual-dev.md`,
so it produces flags that don't work.

### 4. `ref_video` residue in `api-endpoints.md`
The branch correctly purged `ref_video` everywhere (it is no longer a supported role)
**except** `skills/ironlabs-gen/references/api-endpoints.md`, which still mentions it.

### 5. Version numbers still not reconciled
Manifests are `0.2.1` (`marketplace.json:8`, `plugin.json:4`, `openclaw.plugin.json:5`),
but `package.json:3` is `0.1.0` and all four `SKILL.md` are `0.1.0` (director was
*downgraded* 0.3.0→0.1.0 in this branch). No single source of truth.

---

## 🟢 Dead code / repo hygiene

- **Committed build artifact:** `skills/director/scripts/__pycache__/analyze-beats.cpython-314.pyc`
  is tracked (this branch adds it) and is **not** in `.gitignore`. Remove it and add
  `__pycache__/` + `*.pyc` to `.gitignore`.
- **`index.mjs`** — `export default function register() {}` is a no-op stub, wired via
  `package.json` `openclaw.extensions` (`:5-7`). Does nothing.
- **`CODE-REVIEW.md` (this file's prior content)** — was a point-in-time artifact that
  had gone stale: it still told readers to "delete `upload.mjs`" (already deleted in this
  branch) and listed text-to-video, command-injection, unsorted-lists, and the
  FAL/OpenRouter contradiction as open — all fixed. A committed review that misdescribes
  the code is worse than none; keep it regenerated or drop it from the repo.

---

## ⚪ Lower severity / nits

- **`gemini.mjs` doc mismatch:** `--temperature`/`--max-tokens` are rejected by the API,
  so the code now correctly warns "not supported, ignored" (`:315-320`). But the header
  and `--help` still advertise `(default: 1.0)` / `(default: 8192)` as if they work
  (`:23-24`, `:285-286`).
- **`src/index.ts` `runPreviousStatusLine` (`:43-59`)** runs an arbitrary shell command
  from `~/.ironlabs/previous-statusline.json` on every refresh. It is the user's own saved
  config, the code documents it, and setup now `chmod 600`s the file — risk is low, but it
  remains an unguarded `execSync` on every status tick.

---

## Verified fixed since the last review (for the record)

- Text-to-video no longer hard-errors — `image_url` is omitted for pure t2v
  (`ironlabs-cli.mjs:290-299`).
- `material-ingest.mjs` uses `execFileSync` with an argv array — command-injection surface
  closed (`:98-102`).
- Local task/material lists sort by id before slicing (`:72`, `:99`).
- `nextId()` folds `process.pid` + a sequence so same-millisecond creates don't collide
  (`:44-48`).
- `credit estimate` surfaces "no pricing data" for unknown aliases instead of silently
  repricing against the default (`:211-231`).
- FAL→OpenRouter story is now consistent across the SKILL docs and `setup.md`.

---

## Highest-value fixes, in order

1. **`credits-cache.ts:80`** — delete the extra `}`. Restores the statusLine build.
2. **`ironlabs-cli.mjs:195`** — add the missing `const raw = …`. Restores `credit me`.
3. **`match-materials.mjs`** — emit uploaded material IDs (or document an upload step);
   otherwise the tool produces non-working `--materials` flags.
4. Remove the committed `.pyc` and gitignore `__pycache__/`.
5. Reconcile version numbers; scrub the last `ref_video` mention from `api-endpoints.md`.
