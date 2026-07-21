# Code Review — ironlabs-plugin

> Review of branch `add-claude-review` vs `main`. Every finding was verified against the
> code (tsc, `node --check`, grep). **All findings below have since been fixed in this
> branch** — status is marked ✅ on each item; see "Fixes applied" at the bottom.

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

## 🔴 Show-stoppers (introduced by the balance refactor)

### 1. ✅ `src/credits-cache.ts` does not compile — stray closing brace
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

### 2. ✅ `ironlabs-cli.mjs` `getMe()` references an undefined variable `raw`
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

### 3. ✅ `match-materials.mjs` output is incompatible with the current CLI
The workflow migrated from `video-gen.sh --materials "path:role"` to uploaded material
**IDs** (`task generate --materials "194:ref_image"`). But
`skills/ironlabs-gen/scripts/match-materials.mjs:97-124` still emits **localPath**-based
flags (`assets/char.jpg:ref_image`), and its header comment (`:17`) references the
now-deleted `video-gen.sh`. Fed to the CLI, `buildCreateParams` does
`parseInt("assets/char.jpg")` → `NaN` → `readMaterial(NaN)` → null → **the material is
silently dropped**. This script is referenced live from `SKILL.md` and `visual-dev.md`,
so it produces flags that don't work.

### 4. ✅ `ref_video` residue in `api-endpoints.md`
The branch correctly purged `ref_video` everywhere (it is no longer a supported role)
**except** `skills/ironlabs-gen/references/api-endpoints.md`, which still mentions it.

### 5. ✅ Version numbers still not reconciled
Manifests are `0.2.1` (`marketplace.json:8`, `plugin.json:4`, `openclaw.plugin.json:5`),
but `package.json:3` is `0.1.0` and all four `SKILL.md` are `0.1.0` (director was
*downgraded* 0.3.0→0.1.0 in this branch). No single source of truth.

---

## 🟢 Dead code / repo hygiene

- **✅ Committed build artifact:** `__pycache__/analyze-beats.cpython-314.pyc` was tracked
  and not ignored. Untracked (`git rm --cached`), deleted, and `__pycache__/` + `*.pyc`
  added to `.gitignore`.
- **`index.mjs`** — `export default function register() {}` is a no-op stub, wired via
  `package.json` `openclaw.extensions` (`:5-7`). Does nothing. **Left in place** — it's the
  OpenClaw extension entry point the manifest expects; removing it needs an OpenClaw-side
  decision, not a code cleanup.
- **`CODE-REVIEW.md` (this file's prior content)** — was a point-in-time artifact that
  had gone stale: it still told readers to "delete `upload.mjs`" (already deleted in this
  branch) and listed text-to-video, command-injection, unsorted-lists, and the
  FAL/OpenRouter contradiction as open — all fixed. A committed review that misdescribes
  the code is worse than none; keep it regenerated or drop it from the repo.

---

## ⚪ Lower severity / nits

- **✅ `gemini.mjs` doc mismatch:** the header and `--help` advertised `(default: 1.0)` /
  `(default: 8192)` for `--temperature`/`--max-tokens` as if they worked; both now read
  "Not supported by the gateway — ignored" to match the runtime warning.
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

## Fixes applied (this pass)

1. **`credits-cache.ts`** — removed the stray `}` and re-indented the block.
   `npx tsc --noEmit` now passes; the statusLine builds again.
2. **`ironlabs-cli.mjs` `getMe()`** — added `const raw = data.data?.totalBalance ?? data.balance`.
   `credit me` no longer throws `ReferenceError`; `credit estimate` smoke-tested OK.
3. **`match-materials.mjs`** — stderr summary now prints the `material upload` command per
   matched file and a `--materials "${VAR}:role"` template instead of bare paths; header
   comment updated (no more `video-gen.sh`). Smoke-tested against a fixture.
4. **`.pyc`** — untracked + deleted; `__pycache__/` and `*.pyc` added to `.gitignore`.
5. **Versions** — `package.json` and all four `SKILL.md` bumped `0.1.0` → `0.2.1` to match
   the manifests (now a single version everywhere).
6. **`api-endpoints.md`** — removed the last `ref_video` role row.
7. **`gemini.mjs`** — docs/`--help` for `--temperature`/`--max-tokens` now say "not
   supported — ignored".

Verification: `npx tsc --noEmit` clean; `node --check` passes on all `.mjs`; no `ref_video`
references remain outside this file; all manifests + skills report `0.2.1`.

### Not changed (intentionally)

- **`index.mjs` no-op stub** — it is the OpenClaw extension entry the manifest points at;
  removal is an OpenClaw-integration decision, not a code cleanup.
- **`runPreviousStatusLine` `execSync`** — low risk (user's own config, `chmod 600`); left
  as-is and documented.
