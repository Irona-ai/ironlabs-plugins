#!/usr/bin/env node
/**
 * match-materials.mjs — Shot-material matching engine.
 *
 * Assigns materials from a material-pool.json to shots in a project.json
 * using a local scoring algorithm (no API calls required).
 *
 * Scoring:
 *   +3  per overlapping tag
 *   +2  per overlapping description keyword
 *   +2  type-match bonus (product↔product, scene↔scene)
 *   -10 penalty for face-containing images in ref_image roles
 *
 * Usage:
 *   node match-materials.mjs --pool material-pool.json --shots project.json [--output mapping.json]
 *
 * The mapping lists each match by localPath + suggestedRole. `task generate --materials`
 * consumes uploaded material IDs (not file paths), so each localPath must first be
 * uploaded with `ironlabs-cli.mjs material upload <path>` and the returned numeric ID
 * substituted into the flag. The stderr summary prints the exact upload commands.
 */

import { readFileSync, writeFileSync, existsSync } from 'fs';

function parseArgs(argv) {
  const map = {};
  for (let i = 0; i < argv.length; i++) {
    if (argv[i].startsWith('--')) map[argv[i].slice(2)] = argv[i + 1] ?? true;
  }
  return map;
}

function tokenize(text = '') {
  return text.toLowerCase().replace(/[^a-z0-9 ]/g, ' ').split(/\s+/).filter(w => w.length > 2);
}

function score(material, shot) {
  const shotText = [
    shot.prompt ?? '',
    shot.scene ?? '',
    shot.action ?? '',
    shot.camera ?? '',
    Array.isArray(shot.characters) ? shot.characters.join(' ') : '',
  ].join(' ');

  const shotTokens = new Set(tokenize(shotText));
  const matTags = new Set((material.tags ?? []).map(t => t.toLowerCase()));
  const matDesc = new Set(tokenize(material.description ?? ''));

  let s = 0;
  for (const t of shotTokens) if (matTags.has(t)) s += 3;
  for (const t of shotTokens) if (matDesc.has(t)) s += 2;

  if (shot.preferredType && material.type === shot.preferredType) s += 2;
  if (material.has_face) s -= 10;

  return s;
}

// 'needs-frame-extraction' and 'face-blocked' are sentinels, not valid --materials
// roles — the CLI only consumes ref_image/first_frame. A reference video must be
// reduced to a still (e.g. via ffmpeg tail-frame extraction) before it can anchor a
// shot, and a face-bearing still is held back because the upstream models apply
// privacy detection to real faces.
function suggestRole(material) {
  if (material.has_face) return 'face-blocked';
  if (material.type === 'reference-video') return 'needs-frame-extraction';
  return 'ref_image';
}

const args = parseArgs(process.argv.slice(2));

if (!args.pool || !args.shots) {
  console.error('Usage: match-materials.mjs --pool material-pool.json --shots project.json [--output mapping.json]');
  process.exit(1);
}

if (!existsSync(args.pool))  { console.error(`Pool not found: ${args.pool}`);  process.exit(1); }
if (!existsSync(args.shots)) { console.error(`Shots not found: ${args.shots}`); process.exit(1); }

const { materials } = JSON.parse(readFileSync(args.pool, 'utf8'));
const projectData   = JSON.parse(readFileSync(args.shots, 'utf8'));
const shots         = projectData.shots ?? projectData;

if (!Array.isArray(shots) || shots.length === 0) {
  console.error('Error: No shots found in the project file.');
  process.exit(1);
}

const mapping = shots.map(shot => {
  const scored = materials
    .map(m => ({ material: m, score: score(m, shot) }))
    .filter(({ score: s }) => s > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 3);

  return {
    shot_id: shot.shot_id ?? shot.id,
    matches: scored.map(({ material, score: s }) => ({
      localPath: material.localPath ?? material.file,
      file: material.file,
      type: material.type,
      score: s,
      suggestedRole: suggestRole(material),
    })),
  };
});

for (const { shot_id, matches } of mapping) {
  console.error(`\n${shot_id}:`);
  if (matches.length === 0) {
    console.error('  (no matches)');
  } else {
    for (const m of matches) {
      console.error(`  ${m.file} [${m.suggestedRole}] score=${m.score}`);
    }
  }
}

// `task generate --materials` takes uploaded material IDs, not file paths. Emit the
// upload command for each matched file plus a --materials template with ${VAR} slots
// the caller fills from `material upload` output — never bare paths (parseInt(path) → NaN
// → the CLI silently drops the material).
const uploadVar = (shotId, i) => `${String(shotId).replace(/[^A-Za-z0-9]/g, '_').toUpperCase()}_MAT${i + 1}`;

console.error('\n  Upload matched files, then pass the returned IDs to task generate:\n');
for (const { shot_id, matches } of mapping) {
  const needsExtraction = matches.filter(m => m.suggestedRole === 'needs-frame-extraction');
  const usable = matches.filter(m => m.suggestedRole === 'ref_image' || m.suggestedRole === 'first_frame');
  if (usable.length === 0) {
    console.error(`  ${shot_id}: (no materials)`);
  } else {
    // The connector accepts exactly one still per generation, so emitting a
    // comma-joined list of every match produced a flag whose extra entries the
    // CLI warns about and drops. Emit only the top-scoring match, and name the
    // runners-up as alternatives to swap in by hand.
    const [best, ...alternates] = usable;
    const bestVar = uploadVar(shot_id, 0);
    console.error(`  ${shot_id}: ${bestVar}=$(node ironlabs-cli.mjs material upload "${best.localPath}" | jq -r '.material.id')`);
    console.error(`  ${shot_id}: --materials "\${${bestVar}}:${best.suggestedRole}"`);
    for (const alt of alternates) {
      console.error(`    alt (score=${alt.score}): ${alt.file} — swap in instead of the above, or compose both into one image first`);
    }
  }
  for (const m of needsExtraction) {
    console.error(`    note: ${m.file} is a reference video — extract a frame with ffmpeg first, then upload and use as first_frame`);
  }
  for (const m of matches.filter(x => x.suggestedRole === 'face-blocked')) {
    console.error(`    note: ${m.file} contains a real face — not used as a reference (privacy detection). Describe the character in text, or generate a portrait to use instead.`);
  }
}

const output = { mapping };

if (args.output) {
  writeFileSync(args.output, JSON.stringify(output, null, 2), 'utf8');
  console.error(`\nMapping written to ${args.output}`);
} else {
  process.stdout.write(JSON.stringify(output, null, 2) + '\n');
}
