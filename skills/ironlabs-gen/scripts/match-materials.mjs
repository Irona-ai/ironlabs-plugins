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
 * Output materials flags use localPath so they can be passed directly to video-gen.sh:
 *   --materials "assets/char.jpg:ref_image,assets/scene.jpg:ref_image"
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

function suggestRole(material) {
  if (material.has_face) return 'asset';
  if (material.type === 'reference-video') return 'ref_video';
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

console.error('\n  --materials flags per shot:\n');
for (const { shot_id, matches } of mapping) {
  if (matches.length === 0) {
    console.error(`  ${shot_id}: (no materials)`);
  } else {
    const flag = matches
      .filter(m => m.suggestedRole !== 'asset')
      .map(m => `${m.localPath}:${m.suggestedRole}`)
      .join(',');
    console.error(`  ${shot_id}: --materials "${flag}"`);
  }
}

const output = { mapping };

if (args.output) {
  writeFileSync(args.output, JSON.stringify(output, null, 2), 'utf8');
  console.error(`\nMapping written to ${args.output}`);
} else {
  process.stdout.write(JSON.stringify(output, null, 2) + '\n');
}
