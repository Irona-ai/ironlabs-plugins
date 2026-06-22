#!/usr/bin/env node

// src/errors.ts
var ApiError = class extends Error {
  constructor(status, body, message) {
    super(message || `API Error ${status}: ${JSON.stringify(body)}`);
    this.status = status;
    this.body = body;
    this.name = "ApiError";
  }
};
var AuthError = class extends ApiError {
  constructor(body) {
    super(401, body, "Authentication failed — check your API key");
    this.name = "AuthError";
  }
};
var InsufficientCreditError = class extends ApiError {
  available;
  required;
  constructor(body) {
    super(402, body, `Insufficient credits: need ${body.required}, have ${body.available}`);
    this.name = "InsufficientCreditError";
    this.available = body.available ?? 0;
    this.required = body.required ?? 0;
  }
};

// Local task/material store helpers
import { mkdirSync, writeFileSync, readFileSync, readdirSync, unlinkSync } from "fs";
import { join } from "path";
import os from "os";

const IRONLABS_DIR = join(os.homedir(), ".ironlabs");
const TASK_DIR = join(IRONLABS_DIR, "tasks");
const MATERIAL_DIR = join(IRONLABS_DIR, "materials");

function writeTask(id, data) {
  try {
    mkdirSync(TASK_DIR, { recursive: true });
    writeFileSync(join(TASK_DIR, `${id}.json`), JSON.stringify(data));
  } catch {}
}
function readTask(id) {
  try { return JSON.parse(readFileSync(join(TASK_DIR, `${id}.json`), "utf-8")); } catch { return null; }
}
function listLocalTasks(params = {}) {
  try {
    return readdirSync(TASK_DIR)
      .filter(f => f.endsWith(".json"))
      .slice(0, params.limit || 50)
      .map(f => {
        try {
          const d = JSON.parse(readFileSync(join(TASK_DIR, f), "utf-8"));
          return { id: d.taskId, status: d.status, model: d.model || "unknown", prompt: d.prompt || "", tags: JSON.stringify(d.tags || []) };
        } catch { return null; }
      }).filter(Boolean);
  } catch { return []; }
}
function writeMaterial(id, data) {
  try {
    mkdirSync(MATERIAL_DIR, { recursive: true });
    writeFileSync(join(MATERIAL_DIR, `${id}.json`), JSON.stringify(data));
  } catch {}
}
function readMaterial(id) {
  try { return JSON.parse(readFileSync(join(MATERIAL_DIR, `${id}.json`), "utf-8")); } catch { return null; }
}
function listLocalMaterials(params = {}) {
  try {
    return readdirSync(MATERIAL_DIR)
      .filter(f => f.endsWith(".json"))
      .slice(0, params.limit || 50)
      .map(f => {
        try {
          const d = JSON.parse(readFileSync(join(MATERIAL_DIR, f), "utf-8"));
          if (params.type && d.type !== params.type) return null;
          return { id: d.id, type: d.type || "image", name: d.name || f };
        } catch { return null; }
      }).filter(Boolean);
  } catch { return []; }
}

// FAL pricing (USD per unit)
const FAL_PRICING = {
  "fal-ai/minimax/video-01":      { type: "video", perSecond: 0.035 },
  "fal-ai/minimax/video-01-lite": { type: "video", perSecond: 0.015 },
  "fal-ai/flux/dev":              { type: "image", flat: 0.025 },
  "fal-ai/flux-pro/v1.1":         { type: "image", flat: 0.040 },
  "fal-ai/ideogram/v2":           { type: "image", flat: 0.080 },
  "fal-ai/gpt-image-1":           { type: "image", flat: 0.060 },
};

// FAL model aliases
const VIDEO_MODEL_MAP = {
  "renoise-2.0": "fal-ai/minimax/video-01",
  "renoise-2.0-fast": "fal-ai/minimax/video-01-lite",
  "youmeng-2.0": "fal-ai/minimax/video-01",
  "seedance-2.0": "fal-ai/minimax/video-01",
  "sd-2.0": "fal-ai/minimax/video-01",
};
const IMAGE_MODEL_MAP = {
  "nano-banana-2": "fal-ai/flux/dev",
  "nano-banana-pro": "fal-ai/flux-pro/v1.1",
  "midjourney-v7": "fal-ai/ideogram/v2",
  "midjourney": "fal-ai/ideogram/v2",
  "gpt-image-2": "fal-ai/gpt-image-1",
};
const RATIO_TO_IMAGE_SIZE = {
  "1:1": "square_hd", "16:9": "landscape_16_9", "9:16": "portrait_16_9",
  "4:3": "landscape_4_3", "3:4": "portrait_4_3", "21:9": "landscape_16_9",
};

// src/client.ts
var IronlabsClient = class {
  baseUrl;
  apiKey;
  constructor(config) {
    this.baseUrl = config.baseUrl.replace(/\/$/, "");
    this.apiKey = config.apiKey;
  }
  buildAuthHeaders() {
    return { Authorization: `Bearer ${this.apiKey}` };
  }
  async request(method, path, body) {
    const url = `${this.baseUrl}${path}`;
    const headers = { ...this.buildAuthHeaders() };
    if (body) headers["Content-Type"] = "application/json";
    const resp = await fetch(url, { method, headers, body: body ? JSON.stringify(body) : void 0 });
    if (resp.status === 401) throw new AuthError(await resp.json().catch(() => ({})));
    if (resp.status === 402) throw new InsufficientCreditError(await resp.json().catch(() => ({})));
    const data = await resp.json().catch(() => ({}));
    if (!resp.ok) throw new ApiError(resp.status, data, data.error || data.message);
    return data;
  }
  // ---- Sandbox token ----
  async issueSandboxToken(scope) {
    const data = await this.request("POST", "/ext/token", { scope, ttlSeconds: 3600 });
    return data.data?.token || data.token;
  }
  // ---- MCP call ----
  async mcpCall(connector, toolName, toolArguments) {
    const token = await this.issueSandboxToken([connector]);
    const url = `${this.baseUrl}/mcp/${connector}`;
    const resp = await fetch(url, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", Accept: "application/json, text/event-stream" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: toolName, arguments: toolArguments } }),
    });
    if (!resp.ok) {
      const err = await resp.json().catch(() => ({}));
      throw new ApiError(resp.status, err, err.error?.message || err.message);
    }
    const contentType = resp.headers.get("content-type") ?? "";
    let result;
    if (contentType.includes("text/event-stream")) {
      const text = await resp.text();
      const dataLine = text.split("\n").find(l => l.startsWith("data:"));
      if (!dataLine) throw new ApiError(500, {}, "No data in SSE response");
      result = JSON.parse(dataLine.slice(5).trim());
    } else {
      result = await resp.json();
    }
    if (result.error) throw new ApiError(400, result.error, result.error.message);
    const content = result.result?.content;
    if (!content?.length) throw new ApiError(500, {}, "Empty MCP response");
    const textContent = content.find(c => c.type === "text");
    if (!textContent) throw new ApiError(500, {}, "No text content in MCP response");
    try { return JSON.parse(textContent.text); } catch { return { text: textContent.text }; }
  }
  // ---- Credit ----
  async getMe() {
    const data = await this.request("GET", "/chat/balance");
    const balance = data.data?.totalBalance ?? data.balance ?? 0;
    return { user: { id: "ironlabs-user", balance }, balance };
  }
  async estimateCost(params = {}) {
    const isImage = this.isImageModel(params.model);
    const falModel = this.mapFalModel(params.model, isImage);
    const pricing = FAL_PRICING[falModel];
    if (!pricing) return { credits: 0, note: `No pricing data for ${falModel || "unknown model"}` };
    const usd = pricing.type === "video"
      ? (parseInt(params.duration) || 5) * pricing.perSecond
      : pricing.flat;
    return { credits: Math.ceil(usd * 100), usd: parseFloat(usd.toFixed(4)), model: falModel };
  }
  async getCreditHistory(limit = 50) {
    const data = await this.request("GET", `/chat/transactions?limit=${limit}`);
    return { transactions: data.data?.transactions ?? [] };
  }
  // ---- Task ----
  isImageModel(model) {
    if (!model) return false;
    return Object.keys(IMAGE_MODEL_MAP).includes(model) ||
      ["flux", "ideogram", "gpt-image", "imagen"].some(k => model.includes(k));
  }
  mapFalModel(model, isImage) {
    if (!model) return isImage ? "fal-ai/flux/dev" : "fal-ai/minimax/video-01";
    if (model.includes("/")) return model; // already a FAL model path
    return (isImage ? IMAGE_MODEL_MAP : VIDEO_MODEL_MAP)[model] ||
      (isImage ? "fal-ai/flux/dev" : "fal-ai/minimax/video-01");
  }
  buildFalInput(params, isImage) {
    const input = { prompt: params.prompt };
    if (isImage) {
      input.image_size = RATIO_TO_IMAGE_SIZE[params.ratio] || "square_hd";
      if (params.resolution) {
        const resMap = { "2k": "landscape_16_9", "4k": "landscape_16_9" };
        if (resMap[params.resolution]) input.image_size = resMap[params.resolution];
      }
    } else {
      if (params.ratio) input.aspect_ratio = params.ratio;
      if (params.duration) input.duration = Math.min(10, parseInt(params.duration));
      if (params.resolution) {
        const vidResMap = { "1k": "720p", "2k": "1080p", "4k": "1080p" };
        input.resolution = vidResMap[params.resolution] || params.resolution;
      }
    }
    // Resolve materials
    if (params.materials?.length) {
      for (const mat of params.materials) {
        const dataUri = mat._dataUri;
        if (!dataUri) continue;
        if (mat.role === "first_frame" || mat.role === "ref_image") {
          input.first_frame_image_url = dataUri;
        } else if (mat.role === "last_frame") {
          input.last_frame_image_url = dataUri;
        } else if (mat.role === "ref_video") {
          input.reference_video_url = dataUri;
        }
      }
    }
    return input;
  }
  async createTask(params) {
    const isImage = this.isImageModel(params.model);
    // Resolve material data URIs
    if (params.materials?.length) {
      for (const mat of params.materials) {
        let matData = null;
        if (mat.id) matData = readMaterial(mat.id);
        else if (mat.user_asset_id) matData = readMaterial(`asset-${mat.user_asset_id}`);
        else if (mat.character_id) matData = readMaterial(`char-${mat.character_id}`);
        if (matData) mat._dataUri = matData.dataUri || matData.url;
      }
    }
    const falModel = this.mapFalModel(params.model, isImage);
    const falInput = this.buildFalInput(params, isImage);
    console.log(`Calling FAL via IronLabs connector (${falModel})...`);
    const falResult = await this.mcpCall("fal", "fal_run", { model: falModel, input: falInput });
    const taskId = Date.now();
    const videoUrl = falResult.video?.url || falResult.videos?.[0]?.url || null;
    const imageUrl = falResult.images?.[0]?.url || falResult.image?.url || null;
    const coverUrl = falResult.video?.thumbnail_url || falResult.thumbnail_url || null;
    const result = {
      taskId, status: "completed",
      model: falModel, prompt: params.prompt,
      tags: params.tags || [],
      videoUrl, imageUrl, coverUrl, falResult,
    };
    writeTask(taskId, result);
    return { task: { id: taskId, status: "completed", estimatedCredit: 0 } };
  }
  async listTasks(params = {}) {
    return { tasks: listLocalTasks(params) };
  }
  async getTask(id) {
    const result = readTask(id);
    if (!result) throw new ApiError(404, {}, `Task #${id} not found`);
    return { task: { id, status: result.status } };
  }
  async getTaskResult(id) {
    const result = readTask(id);
    if (!result) throw new ApiError(404, {}, `Task #${id} result not found`);
    return result;
  }
  async cancelTask() { return {}; }
  async updateTags(id, tags) {
    const result = readTask(id);
    if (result) { result.tags = tags; writeTask(id, result); }
    return {};
  }
  async listTags() { return { tags: [] }; }
  async waitForTask(id) {
    // Tasks are synchronous via MCP — already completed at createTask time
    return this.getTaskResult(id);
  }
  async generate(params, options) {
    const { task } = await this.createTask(params);
    return this.waitForTask(task.id, options);
  }
  // ---- Material ----
  async uploadMaterial(file, filename, type = "image") {
    const matId = Date.now();
    const ext = filename.split(".").pop()?.toLowerCase() || "jpg";
    const mimeType = type === "video" ? "video/mp4"
      : ext === "png" ? "image/png"
      : ext === "webp" ? "image/webp" : "image/jpeg";
    const b64 = Buffer.from(file).toString("base64");

    // Try CDN upload; fall back to local base64 if unavailable
    let url = null;
    if (this.apiKey) {
      try {
        const resp = await fetch(`${this.baseUrl}/upload`, {
          method: "POST",
          headers: { Authorization: `Bearer ${this.apiKey}`, "Content-Type": "application/json" },
          body: JSON.stringify({ filename, data: b64, mimeType }),
        });
        if (resp.ok) {
          const json = await resp.json();
          url = json.data?.url ?? null;
        }
      } catch {
        // fall through to local storage
      }
    }

    const entry = url
      ? { id: matId, name: filename, type, url }
      : { id: matId, name: filename, type, dataUri: `data:${mimeType};base64,${b64}` };

    writeMaterial(matId, entry);
    return { material: { id: matId, name: filename, type, url }, action: "uploaded" };
  }
  async listMaterials(params = {}) {
    return { materials: listLocalMaterials(params) };
  }
  // ---- Character (stored locally as type "character") ----
  async listCharacters() {
    try {
      const files = readdirSync(MATERIAL_DIR).filter(f => f.startsWith("char-") && f.endsWith(".json"));
      const characters = files.slice(0, 50).map(f => {
        try {
          const d = JSON.parse(readFileSync(join(MATERIAL_DIR, f), "utf-8"));
          return { id: d.id, name: d.name };
        } catch { return null; }
      }).filter(Boolean);
      return { characters, total: characters.length };
    } catch { return { characters: [], total: 0 }; }
  }
  async getCharacter(id) {
    const data = readMaterial(`char-${id}`);
    if (!data) throw new ApiError(404, {}, `Character #${id} not found`);
    return { character: { id, name: data.name } };
  }
  async importCharacters(file, filename) {
    if (!file || !filename) throw new ApiError(400, {}, "Usage: ironlabs character create <image-file>");
    const matId = Date.now();
    const ext = filename.split(".").pop()?.toLowerCase() || "jpg";
    const mimeType = ext === "png" ? "image/png" : ext === "webp" ? "image/webp" : "image/jpeg";
    const dataUri = `data:${mimeType};base64,${Buffer.from(file).toString("base64")}`;
    writeMaterial(`char-${matId}`, { id: matId, name: filename, type: "character", dataUri });
    return { character: { id: matId, name: filename }, action: "created" };
  }
  async getCharacterImageUploadUrl() {
    return { note: "Upload characters directly: ironlabs character create <image-file>" };
  }
  async addCharacterGrant() { return {}; }
  // ---- Asset (stored locally with key "asset-<id>") ----
  async createAsset(file, filename, type = "image") {
    if (!file || !filename) throw new ApiError(400, {}, "Usage: ironlabs asset create <file>");
    const matId = Date.now();
    const ext = filename.split(".").pop()?.toLowerCase() || "jpg";
    const videoExts = ["mp4", "mov", "webm", "avi", "mkv"];
    const assetType = (type === "video" || videoExts.includes(ext)) ? "video" : "image";
    const mimeType = assetType === "video" ? "video/mp4"
      : ext === "png" ? "image/png"
      : ext === "webp" ? "image/webp" : "image/jpeg";
    const dataUri = `data:${mimeType};base64,${Buffer.from(file).toString("base64")}`;
    writeMaterial(`asset-${matId}`, { id: matId, name: filename, type: "asset", assetType, dataUri });
    return { asset: { id: matId, name: filename, type: assetType }, action: "created" };
  }
  async getAsset(id) {
    const data = readMaterial(`asset-${id}`);
    if (!data) throw new ApiError(404, {}, `Asset #${id} not found`);
    return { asset: { id, name: data.name, type: data.assetType || "image" } };
  }
  async listAssets() {
    try {
      const files = readdirSync(MATERIAL_DIR).filter(f => f.startsWith("asset-") && f.endsWith(".json"));
      const assets = files.slice(0, 50).map(f => {
        try {
          const d = JSON.parse(readFileSync(join(MATERIAL_DIR, f), "utf-8"));
          return { id: d.id, name: d.name, type: d.assetType || "image" };
        } catch { return null; }
      }).filter(Boolean);
      return { assets };
    } catch { return { assets: [] }; }
  }
  async deleteAsset(id) {
    try { unlinkSync(join(MATERIAL_DIR, `asset-${id}.json`)); } catch {}
    return {};
  }
  async waitForAsset(id) { return this.getAsset(id); }
  async createAssetGroup() { return { group: { id: Date.now(), name: "default" } }; }
  async listAssetGroups() { return []; }
};

// src/cli.ts
import { extname, basename } from "path";
import { fileURLToPath } from "url";
var __dir = fileURLToPath(new URL(".", import.meta.url));
function loadEnv() {
  const candidates = [
    join(process.cwd(), ".env"),
    join(__dir, ".env")
  ];
  for (const p of candidates) {
    try {
      const content = readFileSync(p, "utf-8");
      for (const line of content.split("\n")) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith("#")) continue;
        const eqIdx = trimmed.indexOf("=");
        if (eqIdx === -1) continue;
        const key = trimmed.slice(0, eqIdx).trim();
        let val = trimmed.slice(eqIdx + 1).trim();
        if (val.startsWith('"') && val.endsWith('"') || val.startsWith("'") && val.endsWith("'")) {
          val = val.slice(1, -1);
        }
        if (!process.env[key]) process.env[key] = val;
      }
      break;
    } catch {}
  }
}
function env(key, fallback) {
  const v = process.env[key] ?? fallback;
  if (!v) {
    console.error(`Error: ${key} is not set.\nSet it via environment variable or .env file.`);
    process.exit(1);
  }
  return v;
}
var DEFAULT_BASE_URL = "https://chat.irona.ai/api/v1";
var IMAGE_MODELS = /* @__PURE__ */ new Set(["gpt-image-2", "nano-banana-2", "nano-banana-pro", "midjourney-v7", "midjourney"]);

function createClient(baseUrlOverride, allowAnonymous = false) {
  loadEnv();
  const apiKey = process.env["IRONLABS_API_KEY"] || "";
  if (!apiKey && !allowAnonymous) {
    console.error("Error: IRONLABS_API_KEY is required.\nSet it via environment variable or .env file.\nRun /ironlabs:setup to configure.");
    process.exit(1);
  }
  const baseUrl = baseUrlOverride || process.env["IRONLABS_BASE_URL"] || DEFAULT_BASE_URL;
  return new IronlabsClient({ baseUrl, apiKey });
}

function json(data) {
  console.log(JSON.stringify(data, null, 2));
}
function parseArgs(args) {
  const flags = {};
  const positional = [];
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg.startsWith("--")) {
      const key = arg.slice(2);
      const next = args[i + 1];
      if (next && !next.startsWith("--")) {
        flags[key] = next;
        i++;
      } else {
        flags[key] = "true";
      }
    } else {
      positional.push(arg);
    }
  }
  return { flags, positional };
}
var HELP = `
IRONLABS CLI — AI generation task management

Usage:
  ironlabs <domain> <action> [options]

Domains:
  task        Create, list, and manage generation tasks
  material    Upload and manage materials
  asset       Save and manage asset files (image/video) for generation anchoring
  character   Save and manage character reference images for identity consistency
  credit      Check balance and transaction history

Environment:
  IRONLABS_API_KEY   API key, sent as Authorization: Bearer
                     Get one at https://studio.ironlabs.ai → API Keys
  IRONLABS_BASE_URL  (optional) Full API base URL
                     Default: https://chat.irona.ai/api/v1

Global Flags:
  --base-url <url>   Override API base URL for this command

Run "ironlabs <domain> help" for domain-specific commands.

Note: tasks are generated synchronously via IronLabs FAL connector.
      Results are cached locally in ~/.ironlabs/tasks/.
      Materials are stored locally in ~/.ironlabs/materials/.
`.trim();
var HELP_TASK = `
ironlabs task — Manage generation tasks

Commands:
  generate                    Create task + wait for result (one step)
  create                      Create a task (synchronous via FAL MCP connector)
  list                        List local tasks
  get <id>                    Get task detail
  result <id>                 Get task result
  wait <id>                   Wait for task (already done — returns cached result)
  cancel <id>                 Cancel a task (no-op for synchronous tasks)
  chain <id>                  Download completed task result → upload as material (for ref_video chaining)
  tags                        List all your tags
  tag <id> --tags a,b,c       Update tags on a task

Options for generate/create:
  --prompt <text>             (required) Generation prompt
  --model <name>              Model alias or FAL model (default: renoise-2.0)
  --duration <seconds>        Video duration (default: 5)
  --ratio <w:h>               Aspect ratio (default: 1:1)
  --resolution <1k|2k|4k>     Image resolution (image models)
  --tags <a,b,c>              Comma-separated tags
  --materials <spec>          Material refs: "id:role" or "id1:role1,id2:role2"

Model aliases:
  renoise-2.0         → fal-ai/minimax/video-01 (video, default)
  renoise-2.0-fast    → fal-ai/minimax/video-01-lite (video)
  nano-banana-2       → fal-ai/flux/dev (image)
  nano-banana-pro     → fal-ai/flux-pro/v1.1 (image)
  midjourney-v7       → fal-ai/ideogram/v2 (image)
  gpt-image-2         → fal-ai/gpt-image-1 (image)
  (any fal-ai/... path used directly)

Examples:
  ironlabs task generate --prompt "a cat dancing" --duration 5
  ironlabs task generate --prompt "cute cat" --model nano-banana-2 --resolution 2k
  ironlabs task generate --prompt "hero product shot" --model gpt-image-2 --ratio 16:9
  ironlabs task create --prompt "epic scene" --duration 10 --ratio 16:9
  ironlabs task list --status completed --limit 5
  ironlabs task result 1234567890
  ironlabs task chain 1234567890
`.trim();
var HELP_MATERIAL = `
ironlabs material — Manage materials

Commands:
  list                        List your uploaded materials
  upload <file>               Upload a material (image or video)

Options for list:
  --type <image|video>        Filter by type
  --limit <n>                 Max results (default: 20)

Options for upload:
  --type <image|video>        Override auto-detected type

Materials are stored locally in ~/.ironlabs/materials/ as base64.

Examples:
  ironlabs material list
  ironlabs material upload /path/to/image.jpg
  ironlabs material upload /path/to/video.mp4 --type video
`.trim();
var HELP_CHARACTER = `
ironlabs character — Character reference images for consistent identity across shots

Commands:
  list                        List saved character references
  get <id>                    Get character detail
  create <image-file>         Save an image as a character reference

Characters are stored locally in ~/.ironlabs/materials/ as base64.
Pass to generation with: --characters "<id>:reference_image"

Examples:
  ironlabs character list
  ironlabs character create /path/to/face.jpg
  ironlabs character get 1234567890
`.trim();
var HELP_ASSET = `
ironlabs asset — Registered assets for generation anchoring

Commands:
  list                        List saved assets
  get <id>                    Get asset detail
  create <file>               Save a file as an asset
  register <file>             Alias for create
  delete <id>                 Delete a saved asset

Options for create/register:
  --type <image|video>        Override auto-detected type

Assets are stored locally in ~/.ironlabs/materials/ as base64.
Pass to generation with: --materials "asset:<id>:ref_image"

Examples:
  ironlabs asset list
  ironlabs asset create /path/to/product.jpg
  ironlabs asset create /path/to/clip.mp4 --type video
  ironlabs asset delete 1234567890
`.trim();
var HELP_CREDIT = `
ironlabs credit — Balance and transactions

Commands:
  me                          Show current user balance
  estimate                    Estimate task cost by model and duration
  history                     Show credit transaction history (not available)

Options for estimate:
  --model <name>              Model alias or FAL model (default: renoise-2.0)
  --duration <seconds>        Video duration for video models (default: 5)

Examples:
  ironlabs credit me
  ironlabs credit estimate --model renoise-2.0 --duration 10
  ironlabs credit estimate --model nano-banana-2
`.trim();
async function taskGenerate(client, flags) {
  if (!flags.prompt) {
    console.error("Error: --prompt is required.\n");
    console.log(HELP_TASK);
    process.exit(1);
  }
  const params = buildCreateParams(flags);
  console.log("Creating task...");
  const { task } = await client.createTask(params);
  console.log(`Task #${task.id} created (${task.status}).`);
  const result = await client.waitForTask(task.id);
  console.log("\nDone!");
  printResult(result);
}
async function taskCreate(client, flags) {
  if (!flags.prompt) {
    console.error("Error: --prompt is required.\n");
    console.log(HELP_TASK);
    process.exit(1);
  }
  const params = buildCreateParams(flags);
  const data = await client.createTask(params);
  console.log(`Task created: id=${data.task.id}, status=${data.task.status}`);
  json(data);
}
async function taskList(client, flags) {
  const data = await client.listTasks({
    status: flags.status,
    tag: flags.tag,
    limit: flags.limit ? parseInt(flags.limit) : 20,
    offset: flags.offset ? parseInt(flags.offset) : 0
  });
  console.log(`Found ${data.tasks.length} task(s):\n`);
  for (const t of data.tasks) {
    const tags = (() => {
      try { return JSON.parse(t.tags || "[]"); } catch { return []; }
    })();
    const tagStr = tags.length ? ` [${tags.join(", ")}]` : "";
    console.log(`  #${t.id}  ${t.status.padEnd(10)}  ${t.model}  ${String(t.prompt).slice(0, 60)}${tagStr}`);
  }
}
async function taskGet(client, positional) {
  const id = parseInt(positional[0]);
  if (!id) {
    console.error("Error: task ID required.\nUsage: ironlabs task get <id>");
    process.exit(1);
  }
  json(await client.getTask(id));
}
async function taskResult(client, positional) {
  const id = parseInt(positional[0]);
  if (!id) {
    console.error("Error: task ID required.\nUsage: ironlabs task result <id>");
    process.exit(1);
  }
  const result = await client.getTaskResult(id);
  printResult(result);
}
async function taskWait(client, positional) {
  const id = parseInt(positional[0]);
  if (!id) {
    console.error("Error: task ID required.\nUsage: ironlabs task wait <id>");
    process.exit(1);
  }
  console.log(`Task #${id}: checking cached result (tasks are synchronous)...`);
  const result = await client.waitForTask(id);
  console.log("\nDone!");
  printResult(result);
}
async function taskCancel(client, positional) {
  const id = parseInt(positional[0]);
  if (!id) {
    console.error("Error: task ID required.\nUsage: ironlabs task cancel <id>");
    process.exit(1);
  }
  await client.cancelTask(id);
  console.log(`Task #${id}: no-op (tasks are synchronous and cannot be cancelled).`);
}
async function taskChain(client, positional) {
  const id = parseInt(positional[0]);
  if (!id) {
    console.error("Error: task ID required.\nUsage: ironlabs task chain <id>\n\nDownloads completed task result and uploads as material for ref_video chaining.");
    process.exit(1);
  }
  console.log(`Getting result for task #${id}...`);
  const result = await client.getTaskResult(id);
  const url = result.videoUrl || result.imageUrl;
  if (!url) {
    console.error(`Task #${id} has no video or image result.`);
    process.exit(1);
  }
  const isVideo = !!result.videoUrl;
  const ext = isVideo ? "mp4" : "png";
  const tmpPath = join(os.tmpdir(), `chain-${id}.${ext}`);
  console.log(`Downloading ${isVideo ? "video" : "image"} to ${tmpPath}...`);
  const resp = await fetch(url);
  if (!resp.ok) throw new Error(`Download failed: ${resp.status}`);
  const arrayBuf = await resp.arrayBuffer();
  writeFileSync(tmpPath, Buffer.from(arrayBuf));
  console.log(`Downloaded: ${(arrayBuf.byteLength / 1024 / 1024).toFixed(1)}MB`);
  const type = isVideo ? "video" : "image";
  const buffer = readFileSync(tmpPath);
  const filename = `chain-${id}.${ext}`;
  console.log(`Uploading as ${type} material...`);
  const data = await client.uploadMaterial(buffer, filename, type);
  const matId = data.material?.id || data.id;
  console.log(`\nMaterial #${matId} ready.`);
  console.log(`Use as: --materials "${matId}:ref_${type}"`);
  json(data);
}
async function taskTags(client) {
  json(await client.listTags());
}
async function taskTag(client, positional, flags) {
  const id = parseInt(positional[0]);
  if (!id || !flags.tags) {
    console.error("Usage: ironlabs task tag <id> --tags a,b,c");
    process.exit(1);
  }
  const tags = flags.tags.split(",").map((t) => t.trim());
  json(await client.updateTags(id, tags));
}
async function materialList(client, flags) {
  const data = await client.listMaterials({
    type: flags.type,
    limit: flags.limit ? parseInt(flags.limit) : 20,
  });
  console.log(`Found ${data.materials.length} material(s):\n`);
  for (const m of data.materials) {
    console.log(`  #${m.id}  ${m.type.padEnd(6)}  ${m.name}`);
  }
}
async function materialUpload(client, positional, flags) {
  const filePath = positional[0];
  if (!filePath) {
    console.error("Error: file path required.\nUsage: ironlabs material upload <file> [--type image|video]");
    process.exit(1);
  }
  const ext = extname(filePath).toLowerCase();
  const videoExts = [".mp4", ".mov", ".avi", ".webm", ".mkv"];
  const type = flags.type || (videoExts.includes(ext) ? "video" : "image");
  const buffer = readFileSync(filePath);
  const filename = basename(filePath);
  console.log(`Uploading ${filename} (${type}, ${(buffer.byteLength / 1024).toFixed(1)}KB)...`);
  const data = await client.uploadMaterial(buffer, filename, type);
  if (data.action === "exists") {
    console.log(`Material already exists: #${data.material.id}`);
  } else {
    console.log(`Material uploaded: #${data.material.id}`);
  }
  json(data);
}
async function characterList(client, flags) {
  const data = await client.listCharacters();
  console.log(`Found ${data.characters.length} character(s):\n`);
  for (const c of data.characters) {
    console.log(`  #${c.id}  ${c.name}`);
  }
}
async function characterGet(client, positional) {
  const id = parseInt(positional[0]);
  if (!id) {
    console.error("Error: character ID required.");
    process.exit(1);
  }
  json(await client.getCharacter(id));
}
async function characterCreate(client, positional, flags) {
  const filePath = positional[0];
  if (!filePath) {
    console.error("Error: image file path required.\nUsage: ironlabs character create <image-file>");
    process.exit(1);
  }
  const buffer = readFileSync(filePath);
  const filename = basename(filePath);
  console.log(`Creating character from ${filename} (${(buffer.byteLength / 1024).toFixed(1)}KB)...`);
  const data = await client.importCharacters(buffer, filename);
  console.log(`Character #${data.character.id} created — use as: --characters "${data.character.id}:reference_image"`);
  json(data);
}
async function characterGrant(client, positional) {
  json(await client.addCharacterGrant());
}
// ── Asset commands ──
async function assetCreate(client, positional, flags) {
  const filePath = positional[0];
  if (!filePath) {
    console.error("Error: file path required.\nUsage: ironlabs asset create <file> [--type image|video]");
    process.exit(1);
  }
  const ext = extname(filePath).toLowerCase();
  const videoExts = [".mp4", ".mov", ".avi", ".webm", ".mkv"];
  const type = flags.type || (videoExts.includes(ext) ? "video" : "image");
  const buffer = readFileSync(filePath);
  const filename = basename(filePath);
  console.log(`Creating asset from ${filename} (${type}, ${(buffer.byteLength / 1024).toFixed(1)}KB)...`);
  const data = await client.createAsset(buffer, filename, type);
  console.log(`Asset #${data.asset.id} created — use as: --materials "asset:${data.asset.id}:ref_image"`);
  json(data);
}
async function assetRegister(client, positional, flags) {
  return assetCreate(client, positional, flags);
}
async function assetGet(client, positional) {
  const id = parseInt(positional[0]);
  if (!id) {
    console.error("Error: asset ID required.\nUsage: ironlabs asset get <id>");
    process.exit(1);
  }
  json(await client.getAsset(id));
}
async function assetList(client, flags) {
  const data = await client.listAssets();
  console.log(`Found ${data.assets.length} asset(s):\n`);
  for (const a of data.assets) {
    console.log(`  #${a.id}  ${a.type.padEnd(6)}  ${a.name}`);
  }
}
async function assetWait(client, positional, flags) {
  const id = parseInt(positional[0]);
  if (!id) {
    console.error("Error: asset ID required.\nUsage: ironlabs asset wait <id>");
    process.exit(1);
  }
  json(await client.waitForAsset(id));
}
async function assetDelete(client, positional) {
  const id = parseInt(positional[0]);
  if (!id) {
    console.error("Error: asset ID required.\nUsage: ironlabs asset delete <id>");
    process.exit(1);
  }
  await client.deleteAsset(id);
  console.log(`Asset #${id} deleted.`);
}
async function creditMe(client) {
  json(await client.getMe());
}
async function creditEstimate(client, flags) {
  json(await client.estimateCost({ model: flags.model, duration: flags.duration }));
}
async function creditHistory(client, flags) {
  const data = await client.getCreditHistory(flags.limit ? parseInt(flags.limit) : 50);
  console.log(`Found ${data.transactions.length} transaction(s):\n`);
  for (const t of data.transactions) {
    const sign = t.type === "credit" ? "+" : "-";
    const amt = (Number(t.amount) / 100).toFixed(2);
    const date = new Date(t.createdAt).toLocaleDateString();
    console.log(`  ${date}  ${sign}$${amt}  ${t.reason}`);
  }
}
function buildCreateParams(flags) {
  const params = { prompt: flags.prompt };
  if (flags.model) params.model = flags.model;
  if (flags.duration) params.duration = parseInt(flags.duration);
  if (flags.ratio) params.ratio = flags.ratio;
  if (flags.resolution) params.resolution = flags.resolution;
  if (flags.tags) params.tags = flags.tags.split(",").map((t) => t.trim());
  const allMaterials = [];
  if (flags.materials) {
    for (const m of flags.materials.split(",")) {
      const parts = m.trim().split(":");
      if (parts[0] === "asset") {
        const assetId = parseInt(parts[1]);
        const role = parts[2] || "reference_image";
        allMaterials.push({ user_asset_id: assetId, role });
      } else {
        const [id, role] = parts;
        allMaterials.push({ id: parseInt(id), role: role || "ref_video" });
      }
    }
  }
  if (flags.characters) {
    for (const m of flags.characters.split(",")) {
      const trimmed = m.trim();
      const parts = trimmed.split(":");
      const charId = parseInt(parts[0]);
      const role = parts[1] || "reference_image";
      allMaterials.push({ character_id: charId, role });
    }
  }
  if (allMaterials.length) params.materials = allMaterials;
  return params;
}
function printResult(result) {
  console.log(`Task #${result.taskId}  ${result.status}`);
  if (result.videoUrl) console.log(`  Video: ${result.videoUrl}`);
  if (result.coverUrl) console.log(`  Cover: ${result.coverUrl}`);
  if (result.imageUrl) console.log(`  Image: ${result.imageUrl}`);
  if (result.warning) console.log(`  Warning: ${result.warning}`);
  json(result);
}
var DOMAIN_HELP = {
  task: HELP_TASK,
  material: HELP_MATERIAL,
  asset: HELP_ASSET,
  character: HELP_CHARACTER,
  credit: HELP_CREDIT
};
async function main() {
  const args = process.argv.slice(2);
  const { flags, positional } = parseArgs(args);
  const domain = positional[0];
  const action = positional[1];
  const subPositional = positional.slice(2);
  if (!domain || domain === "help" || flags.help === "true") {
    console.log(HELP);
    return;
  }
  if (action === "help" || !action && flags.help !== "true") {
    console.log(DOMAIN_HELP[domain] || HELP);
    return;
  }
  if (flags.help === "true") {
    console.log(DOMAIN_HELP[domain] || HELP);
    return;
  }
  // credit estimate is pure local math — no API key needed
  if (domain === "credit" && action === "estimate") {
    const isImage = IMAGE_MODELS.has(flags.model || "");
    const falModel = (isImage ? IMAGE_MODEL_MAP : VIDEO_MODEL_MAP)[flags.model] || flags.model ||
      (isImage ? "fal-ai/flux/dev" : "fal-ai/minimax/video-01");
    const pricing = FAL_PRICING[falModel];
    if (!pricing) {
      json({ credits: 0, note: `No pricing data for ${falModel || "unknown model"}` });
    } else {
      const usd = pricing.type === "video"
        ? (parseInt(flags.duration) || 5) * pricing.perSecond
        : pricing.flat;
      json({ credits: Math.ceil(usd * 100), usd: parseFloat(usd.toFixed(4)), model: falModel });
    }
    return;
  }
  const baseUrlOverride = flags["base-url"] || null;
  const localOnlyDomains = new Set(["character", "asset"]);
  const client = createClient(baseUrlOverride, localOnlyDomains.has(domain));
  if (baseUrlOverride) {
    console.log(`ℹ️  Using API: ${baseUrlOverride}`);
  }
  try {
    switch (domain) {
      case "task":
        switch (action) {
          case "generate": await taskGenerate(client, flags); break;
          case "create":   await taskCreate(client, flags); break;
          case "list":     await taskList(client, flags); break;
          case "get":      await taskGet(client, subPositional); break;
          case "result":   await taskResult(client, subPositional); break;
          case "wait":     await taskWait(client, subPositional, flags); break;
          case "cancel":   await taskCancel(client, subPositional); break;
          case "chain":    await taskChain(client, subPositional); break;
          case "tags":     await taskTags(client); break;
          case "tag":      await taskTag(client, subPositional, flags); break;
          default:
            console.error(`Unknown task action: ${action}\n`);
            console.log(HELP_TASK);
            process.exit(1);
        }
        break;
      case "material":
        switch (action) {
          case "list":   await materialList(client, flags); break;
          case "upload": await materialUpload(client, subPositional, flags); break;
          default:
            console.error(`Unknown material action: ${action}\n`);
            console.log(HELP_MATERIAL);
            process.exit(1);
        }
        break;
      case "asset":
        switch (action) {
          case "create":   await assetCreate(client, subPositional, flags); break;
          case "register": await assetRegister(client, subPositional, flags); break;
          case "get":      await assetGet(client, subPositional); break;
          case "list":     await assetList(client, flags); break;
          case "wait":     await assetWait(client, subPositional, flags); break;
          case "delete":   await assetDelete(client, subPositional); break;
          default:
            console.error(`Unknown asset action: ${action}\n`);
            console.log(HELP_ASSET);
            process.exit(1);
        }
        break;
      case "character":
        switch (action) {
          case "list":   await characterList(client, flags); break;
          case "get":    await characterGet(client, subPositional); break;
          case "create": await characterCreate(client, subPositional, flags); break;
          case "grant":  await characterGrant(client, subPositional); break;
          default:
            console.error(`Unknown character action: ${action}\n`);
            console.log(HELP_CHARACTER);
            process.exit(1);
        }
        break;
      case "credit":
        switch (action) {
          case "me":       await creditMe(client); break;
          case "estimate": await creditEstimate(client, flags); break;
          case "history":  await creditHistory(client, flags); break;
          default:
            console.error(`Unknown credit action: ${action}\n`);
            console.log(HELP_CREDIT);
            process.exit(1);
        }
        break;
      default:
        console.error(`Unknown domain: ${domain}\n`);
        console.log(HELP);
        process.exit(1);
    }
  } catch (e) {
    if (e instanceof AuthError) {
      console.error(`Auth Error: ${e.message}`);
      console.error("Make sure IRONLABS_API_KEY is set correctly. Run /ironlabs:setup.");
      process.exit(1);
    }
    if (e instanceof InsufficientCreditError) {
      console.error(`Credit Error: ${e.message}`);
      console.error(`  Available: ${e.available}, Required: ${e.required}`);
      process.exit(1);
    }
    if (e instanceof ApiError) {
      console.error(`API Error (${e.status}): ${e.message}`);
      process.exit(1);
    }
    throw e;
  }
}
main();
