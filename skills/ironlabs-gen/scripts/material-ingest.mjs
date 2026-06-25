#!/usr/bin/env node

/**
 * Material Ingest — Batch local analysis + AI auto-tagging for video production.
 *
 * Scans a directory (or file list), analyzes each with Gemini (via Irona
 * LLM gateway), and writes material-pool.json with local file paths.
 *
 * Usage:
 *   node material-ingest.mjs ./materials/
 *   node material-ingest.mjs product.jpg scene.jpg ref.mp4
 *   node material-ingest.mjs ./materials/ --output project/material-pool.json
 *   node material-ingest.mjs ./materials/ --skip-analysis
 *
 * Environment:
 *   IRONLABS_API_KEY   Required (for Gemini analysis via Irona gateway)
 *   IRONLABS_BASE_URL  Optional (default: https://chat.irona.ai)
 */

import fs from "fs";
import path from "path";
import { execSync } from "child_process";
import { fileURLToPath } from "url";
import { createHash } from "crypto";

const __filename = fileURLToPath(import.meta.url);
const __dir = path.dirname(__filename);

const GEMINI_PATH = path.join(__dir, "..", "..", "gemini-gen", "scripts", "gemini.mjs");

const IMAGE_EXTS = new Set([".jpg", ".jpeg", ".png", ".webp", ".gif", ".bmp", ".tiff"]);
const VIDEO_EXTS = new Set([".mp4", ".mov", ".webm", ".mkv", ".avi"]);
const ALL_EXTS = new Set([...IMAGE_EXTS, ...VIDEO_EXTS]);

function parseArgs(argv) {
  const paths = [];
  let output = "material-pool.json";
  let skipAnalysis = false;
  let append = false;

  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--output" || argv[i] === "-o") {
      output = argv[++i];
    } else if (argv[i] === "--skip-analysis") {
      skipAnalysis = true;
    } else if (argv[i] === "--append") {
      append = true;
    } else if (!argv[i].startsWith("-")) {
      paths.push(argv[i]);
    }
  }
  return { paths, output, skipAnalysis, append };
}

function collectFiles(inputPaths) {
  const files = [];
  for (const p of inputPaths) {
    const stat = fs.statSync(p);
    if (stat.isDirectory()) {
      for (const entry of fs.readdirSync(p)) {
        const full = path.join(p, entry);
        const ext = path.extname(entry).toLowerCase();
        if (fs.statSync(full).isFile() && ALL_EXTS.has(ext)) {
          files.push(full);
        }
      }
    } else if (stat.isFile()) {
      const ext = path.extname(p).toLowerCase();
      if (ALL_EXTS.has(ext)) {
        files.push(p);
      } else {
        console.warn(`⚠️  Skipping unsupported file: ${p}`);
      }
    }
  }
  return files;
}

function localId(filePath) {
  return createHash("md5").update(path.resolve(filePath)).digest("hex").slice(0, 12);
}

function analyzeFile(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  const isVideo = VIDEO_EXTS.has(ext);
  const resolution = isVideo ? "low" : "high";

  const prompt = `Analyze this ${isVideo ? "video" : "image"} for a video production material library.
Return ONLY valid JSON (no markdown fences) with these fields:
- type: one of "product", "scene", "character-ref", "mood-board", "reference-video", "other"
- tags: array of descriptive keyword strings (e.g. "front-view", "white-background", "gym", "outdoor", "close-up")
- description: one sentence describing the content
- has_face: boolean — true if a realistic human face is clearly visible
- colors: array of dominant color names
- suitable_roles: array from ["ref_image", "image1", "image2", "ref_video", "first_frame", "last_frame"]`;

  try {
    const output = execSync(
      `node "${GEMINI_PATH}" --file "${filePath}" --resolution ${resolution} --json '${prompt.replace(/'/g, "'\\''")}'`,
      { encoding: "utf-8", timeout: 120000 }
    );
    const jsonMatch = output.match(/\{[\s\S]*\}/);
    if (jsonMatch) return JSON.parse(jsonMatch[0]);
    return null;
  } catch (err) {
    console.error(`⚠️  Analysis failed for ${filePath}: ${err.message}`);
    return null;
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  if (args.paths.length === 0) {
    console.log(`Material Ingest — Batch local analysis + AI auto-tagging

Usage:
  node material-ingest.mjs <path|directory> [<path2> ...]
  node material-ingest.mjs ./materials/ --output pool.json
  node material-ingest.mjs ./materials/ --skip-analysis
  node material-ingest.mjs ./generated/ --append --output pool.json

Options:
  --output, -o <file>   Output file path (default: material-pool.json)
  --skip-analysis       Skip Gemini analysis, use defaults
  --append              Append to existing pool file`);
    process.exit(0);
  }

  const files = collectFiles(args.paths);
  if (files.length === 0) {
    console.error("No supported image/video files found.");
    process.exit(1);
  }
  console.log(`📦 Found ${files.length} file(s) to ingest:\n`);
  files.forEach((f) => console.log(`  ${path.basename(f)}`));
  console.log();

  console.log("📋 Registering files locally...\n");
  const registered = files.map((file) => {
    const ext = path.extname(file).toLowerCase();
    const type = VIDEO_EXTS.has(ext) ? "video" : "image";
    const id = localId(file);
    console.log(`  ${path.basename(file)} → id:${id}`);
    return { file, type, id };
  });
  console.log(`\n  ${registered.length}/${files.length} registered.\n`);

  const materials = [];
  if (args.skipAnalysis) {
    console.log("⏭️  Skipping Gemini analysis (--skip-analysis).\n");
    for (const r of registered) {
      materials.push({
        id: r.id,
        file: path.basename(r.file),
        localPath: path.resolve(r.file),
        type: r.type === "video" ? "reference-video" : "other",
        tags: [],
        description: "",
        has_face: false,
        colors: [],
        suitable_roles: r.type === "video" ? ["ref_video"] : ["ref_image", "image1"],
      });
    }
  } else {
    console.log("🔍 Analyzing files with Gemini (Irona gateway)...\n");
    for (const r of registered) {
      process.stdout.write(`  Analyzing ${path.basename(r.file)}... `);
      const analysis = analyzeFile(r.file);
      if (analysis) {
        console.log(`✅ ${analysis.type} | has_face: ${analysis.has_face}`);
        materials.push({
          id: r.id,
          file: path.basename(r.file),
          localPath: path.resolve(r.file),
          type: analysis.type || "other",
          tags: analysis.tags || [],
          description: analysis.description || "",
          has_face: !!analysis.has_face,
          colors: analysis.colors || [],
          suitable_roles: analysis.suitable_roles || ["ref_image"],
        });
      } else {
        console.log("⚠️  analysis failed, using defaults");
        materials.push({
          id: r.id,
          file: path.basename(r.file),
          localPath: path.resolve(r.file),
          type: r.type === "video" ? "reference-video" : "other",
          tags: [],
          description: "",
          has_face: false,
          colors: [],
          suitable_roles: r.type === "video" ? ["ref_video"] : ["ref_image", "image1"],
        });
      }
    }
  }

  let existingMaterials = [];
  if (args.append && fs.existsSync(args.output)) {
    try {
      const existing = JSON.parse(fs.readFileSync(args.output, "utf-8"));
      existingMaterials = existing.materials || [];
      console.log(`\n📂 Appending to existing pool (${existingMaterials.length} existing material(s)).`);
    } catch {
      console.warn("⚠️  Could not parse existing pool file, starting fresh.");
    }
  }

  const existingIds = new Set(existingMaterials.map((m) => m.id));
  const newMaterials = materials.filter((m) => !existingIds.has(m.id));
  const allMaterials = [...existingMaterials, ...newMaterials];

  const pool = { created_at: new Date().toISOString(), materials: allMaterials };
  fs.writeFileSync(args.output, JSON.stringify(pool, null, 2));
  console.log(`\n✅ Material pool written to ${args.output}`);
  console.log(`   ${allMaterials.length} material(s) indexed.\n`);

  const withFace = materials.filter((m) => m.has_face);
  if (withFace.length > 0) {
    console.log(`⚠️  ${withFace.length} material(s) contain human faces — excluded from ref_image auto-matching:`);
    withFace.forEach((m) => console.log(`   ${m.id} ${m.file}`));
    console.log();
  }
}

main().catch((err) => {
  console.error("Fatal:", err.message);
  process.exit(1);
});
