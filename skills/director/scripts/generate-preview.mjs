#!/usr/bin/env node
/**
 * generate-preview.mjs — Self-contained HTML storyboard preview generator.
 *
 * Reads project.json, storyboard/ panel images, and material-pool.json
 * from a project directory and emits a single-file HTML preview.
 *
 * Usage:
 *   node generate-preview.mjs <project-dir> [--output preview.html] [--skip-images]
 *
 * project.json shape:
 *   { shots: [{ id, prompt, duration, materials? }], title? }
 */

import { readFileSync, writeFileSync, existsSync, readdirSync } from 'fs';
import { join, resolve } from 'path';

const args = process.argv.slice(2);
const skipImages = args.includes('--skip-images');
const outIdx = args.indexOf('--output');
const outputFile = outIdx !== -1 ? args[outIdx + 1] : null;
const projectDir = args.find(a => !a.startsWith('-') && a !== args[outIdx + 1]) ?? '.';

const projectPath = resolve(projectDir);
const projectJsonPath = join(projectPath, 'project.json');
const materialPoolPath = join(projectPath, 'material-pool.json');
const storyboardDir = join(projectPath, 'storyboard');

if (!existsSync(projectJsonPath)) {
  console.error(`Error: project.json not found in ${projectPath}`);
  process.exit(1);
}

const project = JSON.parse(readFileSync(projectJsonPath, 'utf8'));
const shots = project.shots ?? [];
const title = project.title ?? 'Storyboard Preview';

let materialPool = {};
if (existsSync(materialPoolPath)) {
  materialPool = JSON.parse(readFileSync(materialPoolPath, 'utf8'));
}

function loadPanelB64(shotId) {
  if (skipImages) return null;
  const path = join(storyboardDir, `${shotId}.png`);
  if (!existsSync(path)) return null;
  const data = readFileSync(path).toString('base64');
  return `data:image/png;base64,${data}`;
}

let totalDuration = 0;
const shotCards = shots.map((shot, i) => {
  const dur = shot.duration ?? 10;
  totalDuration += dur;
  const panelSrc = loadPanelB64(shot.id);
  const panelHtml = panelSrc
    ? `<img src="${panelSrc}" style="width:100%;border-radius:4px;margin-bottom:8px">`
    : `<div style="background:#222;height:80px;border-radius:4px;display:flex;align-items:center;justify-content:center;color:#555;font-size:12px;margin-bottom:8px">No panel</div>`;

  return `
  <div style="background:#1a1a1a;border:1px solid #333;border-radius:8px;padding:12px;min-width:200px;max-width:240px">
    <div style="color:#888;font-size:11px;margin-bottom:4px">SHOT ${shot.id} · ${dur}s</div>
    ${panelHtml}
    <details>
      <summary style="cursor:pointer;color:#aaa;font-size:12px">Prompt</summary>
      <p style="color:#ccc;font-size:11px;margin-top:6px;line-height:1.5">${shot.prompt ?? ''}</p>
    </details>
  </div>`;
}).join('\n');

const timelineSegments = shots.map(shot => {
  const pct = ((shot.duration ?? 10) / totalDuration * 100).toFixed(1);
  return `<div style="flex:${pct};background:#333;border-right:2px solid #111;padding:2px 4px;font-size:10px;color:#aaa;overflow:hidden;white-space:nowrap">${shot.id}</div>`;
}).join('');

const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<title>${title}</title>
<style>
  body { font-family: system-ui, sans-serif; background: #0d0d0d; color: #eee; margin: 0; padding: 24px; }
  h1 { font-size: 20px; font-weight: 600; margin-bottom: 4px; }
  .meta { color: #666; font-size: 12px; margin-bottom: 24px; }
  .shots { display: flex; gap: 16px; flex-wrap: wrap; }
  .timeline { display: flex; height: 28px; border-radius: 4px; overflow: hidden; margin-bottom: 24px; background: #111; }
</style>
</head>
<body>
  <h1>${title}</h1>
  <p class="meta">${shots.length} shots · ${totalDuration}s total</p>
  <h3 style="font-size:13px;color:#666;margin-bottom:8px">TIMELINE</h3>
  <div class="timeline">${timelineSegments}</div>
  <h3 style="font-size:13px;color:#666;margin-bottom:12px">SHOTS</h3>
  <div class="shots">${shotCards}</div>
</body>
</html>`;

if (outputFile) {
  writeFileSync(outputFile, html, 'utf8');
  console.log(`Preview written to ${outputFile}`);
} else {
  process.stdout.write(html);
}
