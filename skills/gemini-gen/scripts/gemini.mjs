#!/usr/bin/env node

/**
 * Gemini analysis via Irona's LLM gateway (direct completions).
 * Zero npm dependencies — uses native fetch.
 * Auth: IRONLABS_API_KEY → POST /api/v1/chat/completions (SSE)
 * Model: gemini-3.5-flash (native in Irona gateway — no OpenRouter connector needed)
 *
 * Usage:
 *   node gemini.mjs "Explain quantum computing"
 *   node gemini.mjs --file photo.jpg "Describe this product"
 *   node gemini.mjs --file a.jpg --file b.jpg "Compare these two"
 *   node gemini.mjs --file photo.jpg --mode product
 *   node gemini.mjs --file clip.mp4 --mode video-script
 *   node gemini.mjs --file reference.jpg --mode style
 *   node gemini.mjs --json "Return a JSON object with name and age"
 *
 * Options:
 *   --file <path>         Attach a local file (image/video). Repeatable. ≤20MB inline.
 *   --resolution <level>  low|medium|high|ultra_high (hint only, for prompt context)
 *   --mode <name>         Preset: product, video-script, style
 *   --model <name>        Irona model name (default: gemini-3.5-flash)
 *   --temperature <n>     Temperature (default: 1.0)
 *   --max-tokens <n>      Max output tokens (default: 8192)
 *   --json                Request JSON-only response
 *
 * Environment:
 *   IRONLABS_API_KEY      Required. Get one at https://studio.ironlabs.ai → API Keys
 *   IRONLABS_BASE_URL     Optional. Default: https://chat.irona.ai/api/v1
 */

import fs from "fs/promises";
import path from "path";

const IRONLABS_API_KEY = process.env.IRONLABS_API_KEY;
if (!IRONLABS_API_KEY) {
  console.error("IRONLABS_API_KEY not set. Get one at: https://studio.ironlabs.ai → API Keys");
  process.exit(1);
}

const BASE_URL = (process.env.IRONLABS_BASE_URL || "https://chat.irona.ai/api/v1").replace(/\/$/, "");
const MAX_INLINE_SIZE = 20 * 1024 * 1024; // 20MB

const MIME_MAP = {
  ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png",
  ".webp": "image/webp", ".gif": "image/gif",
  ".mp4": "video/mp4", ".mov": "video/quicktime", ".webm": "video/webm",
};
const VIDEO_MIMES = new Set(["video/mp4", "video/quicktime", "video/webm"]);

function getMimeType(filePath) {
  return MIME_MAP[path.extname(filePath).toLowerCase()] ?? "application/octet-stream";
}

const MODE_PRESETS = {
  product: {
    json: true,
    prompt: `Analyze this product photo for e-commerce video production.
Return ONLY valid JSON with these fields:
- type: product type/category (string)
- color: color description (string)
- material: material/texture description (string)
- selling_points: array of 3-5 key selling points (strings)
- brand_tone: brand personality/tone (string)
- scene_suggestions: array of 3 usage scenario suggestions (strings)
- usage_description: one paragraph describing how the product is used`,
  },
  "video-script": {
    json: false,
    prompt: `Watch this video carefully and extract a detailed production script.
Output the following:
1. SCENE DESCRIPTIONS — timestamped, describe what is shown in each scene
2. DIALOGUE/NARRATION — timestamped, transcribe all spoken words exactly
3. CAMERA MOVEMENTS — timestamped, describe camera angles and movements
4. MUSIC/SOUND — describe background music style, tempo, and key sound effects
5. PACING — describe the editing rhythm (fast cuts, slow takes, etc.)
6. STYLE KEYWORDS — list visual style keywords (lighting, color palette, mood)

Use format: [MM:SS] description`,
  },
  style: {
    json: true,
    prompt: `Analyze this visual reference and extract its style characteristics for video production.
Return ONLY valid JSON with these fields:
- color_palette: array of dominant color descriptions
- lighting: lighting style description (string)
- camera_language: typical camera movements and angles (string)
- composition: composition style notes (string)
- mood: overall mood/atmosphere (string)
- texture: visual texture notes — film grain, clean digital, etc. (string)
- style_keywords: array of 5-10 style keywords suitable for video prompts
- reference_prompt: a 2-3 sentence style prefix that could be prepended to video prompts to recreate this look`,
  },
};

function parseArgs(argv) {
  const files = [];
  const dataUris = [];
  let resolution = "medium";
  let mode = null;
  let model = "gemini-3.5-flash";
  let temperature = 1.0;
  let maxTokens = 8192;
  let jsonMode = false;
  const textParts = [];

  for (let i = 0; i < argv.length; i++) {
    switch (argv[i]) {
      case "--file":        files.push(argv[++i]); break;
      case "--data-uri":    dataUris.push(argv[++i]); break;
      case "--resolution":  resolution = argv[++i]; break;
      case "--mode":        mode = argv[++i]; break;
      case "--model":       model = argv[++i]; break;
      case "--temperature": temperature = parseFloat(argv[++i]); break;
      case "--max-tokens":  maxTokens = parseInt(argv[++i], 10); break;
      case "--json":        jsonMode = true; break;
      default:              textParts.push(argv[i]);
    }
  }

  return { files, dataUris, resolution, mode, model, temperature, maxTokens, jsonMode, prompt: textParts.join(" ") };
}

// Upload a large file to IronLabs CDN and return a public URL.
async function uploadToCdn(filePath, mimeType, base64) {
  const filename = path.basename(filePath);
  const resp = await fetch(`${BASE_URL}/upload`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${IRONLABS_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ filename, data: base64, mimeType }),
  });
  if (!resp.ok) {
    const err = await resp.text();
    throw new Error(`CDN upload failed (${resp.status}): ${err}`);
  }
  const json = await resp.json();
  return json.data?.url;
}

// Build Irona-compatible content parts from files and inline data URIs
async function buildContentParts(files, dataUris, prompt) {
  const parts = [];

  for (const uri of dataUris) {
    if (!uri.startsWith("data:")) {
      console.error(`Skipping invalid --data-uri (must start with "data:"): ${uri.slice(0, 40)}...`);
      continue;
    }
    parts.push({ type: "image_url", image_url: { url: uri } });
  }

  for (const filePath of files) {
    const stat = await fs.stat(filePath);
    const mimeType = getMimeType(filePath);
    const data = await fs.readFile(filePath);
    const base64 = data.toString("base64");

    if (stat.size > MAX_INLINE_SIZE) {
      console.error(`${path.basename(filePath)} is >20MB — uploading to CDN...`);
      try {
        const url = await uploadToCdn(filePath, mimeType, base64);
        parts.push({ type: "image_url", image_url: { url } });
        console.error(`Uploaded: ${url}`);
      } catch (err) {
        console.error(`CDN upload failed: ${err.message}. Skipping file.`);
        console.error(`  Alternative: ffmpeg -i "${filePath}" -vf "fps=1" frame_%04d.jpg`);
      }
      continue;
    }

    const dataUri = `data:${mimeType};base64,${base64}`;
    parts.push({ type: "image_url", image_url: { url: dataUri } });
  }

  if (prompt) {
    parts.push({ type: "text", text: prompt });
  }

  return parts;
}

function applyMode(opts) {
  if (!opts.mode) return opts;
  const preset = MODE_PRESETS[opts.mode];
  if (!preset) {
    console.error(`Unknown mode: ${opts.mode}. Available: ${Object.keys(MODE_PRESETS).join(", ")}`);
    process.exit(1);
  }
  if (preset.json) opts.jsonMode = true;
  if (!opts.prompt) {
    opts.prompt = preset.prompt;
  } else {
    opts.prompt = preset.prompt + "\n\nAdditional instructions: " + opts.prompt;
  }
  return opts;
}

// Create a throwaway conversation and return its ID
async function createConversation() {
  const resp = await fetch(`${BASE_URL}/chat/conversation`, {
    method: "POST",
    headers: { Authorization: `Bearer ${IRONLABS_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ title: "gemini-gen" }),
  });
  if (!resp.ok) {
    const body = await resp.text().catch(() => "(no body)");
    throw new Error(`Failed to create conversation: ${resp.status} — ${body}`);
  }
  const data = await resp.json();
  return data.data?.id ?? data.id;
}

// Call Irona completions endpoint and return the full response text
async function callCompletions(messages, model, jsonMode) {
  const conversationId = await createConversation();
  const resp = await fetch(`${BASE_URL}/chat/completions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${IRONLABS_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      models: [model],
      messages,
      stream: true,
      conversationId,
      ...(jsonMode ? { } : {}),
    }),
  });

  if (!resp.ok) {
    const err = await resp.text();
    throw new Error(`Completions error (${resp.status}): ${err}`);
  }

  // Parse SSE stream — collect text-delta events
  let result = "";
  const decoder = new TextDecoder();
  let buffer = "";

  for await (const chunk of resp.body) {
    buffer += decoder.decode(chunk, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop(); // keep incomplete last line

    for (const line of lines) {
      if (!line.startsWith("data: ")) continue;
      const raw = line.slice(6).trim();
      if (raw === "[DONE]") return result;
      if (raw.startsWith("[Error]")) throw new Error(`Stream error: ${raw}`);
      try {
        const event = JSON.parse(raw);
        if (event.type === "text" && event.text) {
          result += event.text;
        }
      } catch {
        // ignore unparseable lines
      }
    }
  }

  return result;
}

async function main() {
  let opts = parseArgs(process.argv.slice(2));

  if (!opts.prompt && opts.files.length === 0 && opts.dataUris.length === 0 && !opts.mode) {
    console.error(`Usage: node gemini.mjs [options] <prompt>

Options:
  --file <path>         Attach local file (repeatable, ≤20MB inline)
  --data-uri <uri>      Inline base64 data URI (repeatable, e.g. "data:image/jpeg;base64,...")
  --resolution <level>  low / medium / high / ultra_high (hint only)
  --mode <name>         Preset: product, video-script, style
  --model <name>        Irona model (default: gemini-3.5-flash)
  --temperature <n>     Temperature (default: 1.0)
  --max-tokens <n>      Max output tokens (default: 8192)
  --json                Request JSON-only response

Requires: IRONLABS_API_KEY

Examples:
  node gemini.mjs --file photo.jpg --mode product
  node gemini.mjs --data-uri "data:image/jpeg;base64,..." --mode product
  node gemini.mjs --file clip.mp4 --mode video-script
  node gemini.mjs --file ref.jpg --mode style
  node gemini.mjs --file a.jpg --file b.jpg "Compare these two"`);
    process.exit(1);
  }

  opts = applyMode(opts);

  if (opts.jsonMode && opts.prompt && !opts.prompt.includes("JSON")) {
    opts.prompt += "\nRespond with valid JSON only.";
  }

  const contentParts = await buildContentParts(opts.files, opts.dataUris, opts.prompt);

  if (!contentParts.length) {
    console.error("No content to send.");
    process.exit(1);
  }

  const messages = [{ role: "user", content: contentParts }];

  console.error(`Calling ${opts.model} via Irona gateway...`);
  const text = await callCompletions(messages, opts.model, opts.jsonMode);

  console.log(text);
}

main().catch((err) => {
  console.error("ERROR:", err.message);
  process.exit(1);
});
