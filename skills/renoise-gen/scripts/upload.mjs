#!/usr/bin/env node

/**
 * Upload a file for use with gemini-gen and renoise-gen material system.
 * Returns a base64 data URI to stdout (used inline in API requests).
 *
 * Backend change: returns base64 data URI instead of uploading to
 * Renoise gateway (was: POST https://renoise.ai/api/public/v1/llm/files/upload).
 * The returned URI can be embedded directly in IronLabs API requests.
 *
 * Usage: node upload.mjs <file-path>
 *
 * Environment:
 *   IRONLABS_API_KEY  Required (for authentication context, not used in upload)
 */

import fs from "fs/promises";
import path from "path";

const IRONLABS_API_KEY = process.env.IRONLABS_API_KEY;
if (!IRONLABS_API_KEY) {
  console.error("IRONLABS_API_KEY not set. Run /ironlabs:setup first.");
  process.exit(1);
}

const MIME_MAP = {
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
  ".gif": "image/gif",
  ".mp4": "video/mp4",
  ".mov": "video/quicktime",
  ".webm": "video/webm",
  ".mp3": "audio/mpeg",
  ".wav": "audio/wav",
  ".pdf": "application/pdf",
};

function getMimeType(filePath) {
  return MIME_MAP[path.extname(filePath).toLowerCase()] ?? "application/octet-stream";
}

async function main() {
  const filePath = process.argv[2];
  if (!filePath) {
    console.error("Usage: node upload.mjs <file-path>");
    process.exit(1);
  }

  const stat = await fs.stat(filePath).catch(() => {
    console.error(`File not found: ${filePath}`);
    process.exit(1);
  });

  const mimeType = getMimeType(filePath);
  const fileData = await fs.readFile(filePath);
  const fileName = path.basename(filePath);
  const sizeMB = (stat.size / 1024 / 1024).toFixed(1);

  console.error(`Processing ${fileName} (${sizeMB}MB, ${mimeType})...`);

  if (stat.size > 20 * 1024 * 1024) {
    console.error(
      `Warning: ${fileName} is ${sizeMB}MB. Files >20MB may exceed inline limits. ` +
      `Consider extracting frames: ffmpeg -i ${fileName} -vf "fps=1" frame_%04d.jpg`
    );
  }

  const b64 = fileData.toString("base64");
  const dataUri = `data:${mimeType};base64,${b64}`;

  console.error(`Ready as base64 data URI (${(b64.length / 1024).toFixed(0)}KB encoded)`);
  console.log(dataUri);
}

main().catch((err) => {
  console.error("ERROR:", err.message);
  process.exit(1);
});
