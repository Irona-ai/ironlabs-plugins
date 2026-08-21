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
    // Some backend paths (e.g. the MCP connector call) report insufficient balance as
    // a preformatted string rather than structured {available, required} — honor it
    // verbatim when present instead of rendering "need undefined, have undefined".
    super(402, body, body.message || `Insufficient credits: need ${body.required}, have ${body.available}`);
    this.name = "InsufficientCreditError";
    this.available = body.available ?? 0;
    this.required = body.required ?? 0;
  }
};

// Local task/material store helpers
import { mkdirSync, writeFileSync, readFileSync, readdirSync, unlinkSync } from "fs";
import { join } from "path";
import os from "os";
import crypto from "crypto";

const IRONLABS_DIR = join(os.homedir(), ".ironlabs");
const TASK_DIR = join(IRONLABS_DIR, "tasks");
const MATERIAL_DIR = join(IRONLABS_DIR, "materials");

// Mirrors src/credits-cache.ts's cacheFilePath() — same hash scheme, same file —
// so a spend here is immediately visible to the statusLine's balance cache
// instead of waiting out its 30s TTL.
// Truncation length for the cache filename hash — keep in sync with
// src/credits-cache.ts's HASH_LENGTH and gemini.mjs's refreshBalanceCache(),
// or the caches silently diverge.
const BALANCE_CACHE_HASH_LENGTH = 16;
// Pre-per-key-scoping cache file, orphaned on disk after upgrading to the
// per-key scheme below; cleaned up opportunistically.
const LEGACY_BALANCE_CACHE_FILE = join(IRONLABS_DIR, "balance-cache.json");
function balanceCacheFilePath(apiKey) {
  const hash = crypto.createHash("sha256").update(apiKey).digest("hex").slice(0, BALANCE_CACHE_HASH_LENGTH);
  return join(IRONLABS_DIR, `balance-cache-${hash}.json`);
}
// Display-only — never used for spend authorization.
async function refreshBalanceCache(client) {
  try {
    const { balance } = await client.getMe({ signal: AbortSignal.timeout(5000) });
    mkdirSync(IRONLABS_DIR, { recursive: true });
    writeFileSync(balanceCacheFilePath(client.apiKey), JSON.stringify({ balance, updated_at: Date.now() }));
  } catch {
    // Best-effort — a stale statusLine cache for a bit isn't fatal.
    return;
  }
  try {
    unlinkSync(LEGACY_BALANCE_CACHE_FILE);
  } catch {
    // Already gone, or never existed — fine either way.
  }
}

// Monotonic ID generator: Date.now() alone collides when multiple
// tasks/materials are created within the same millisecond (e.g. Promise.all
// batches), silently overwriting each other's stored files. process.pid is
// folded into the starting offset so separate CLI processes launched in the
// same millisecond don't both start counting from 0. Stays within Date.now()
// * 1000's headroom under Number.MAX_SAFE_INTEGER.
const pidSalt = process.pid % 1000;
let idSequence = 0;
function nextId() {
  return Date.now() * 1000 + ((pidSalt + idSequence++) % 1000);
}

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
    let tasks = readdirSync(TASK_DIR)
      .filter(f => f.endsWith(".json"))
      .map(f => {
        try {
          const d = JSON.parse(readFileSync(join(TASK_DIR, f), "utf-8"));
          return { id: d.taskId, status: d.status, model: d.model || "unknown", prompt: d.prompt || "", tags: JSON.stringify(d.tags || []), _rawTags: d.tags || [] };
        } catch { return null; }
      })
      .filter(Boolean);
    if (params.status) tasks = tasks.filter(t => t.status === params.status);
    if (params.tag) tasks = tasks.filter(t => t._rawTags.includes(params.tag));
    tasks.sort((a, b) => b.id - a.id); // most recent first (id is a monotonic timestamp)
    const offset = params.offset || 0;
    const limit = params.limit || 50;
    return tasks.slice(offset, offset + limit).map(({ _rawTags, ...t }) => t);
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
    let materials = readdirSync(MATERIAL_DIR)
      .filter(f => f.endsWith(".json"))
      .map(f => {
        try {
          const d = JSON.parse(readFileSync(join(MATERIAL_DIR, f), "utf-8"));
          if (params.type && d.type !== params.type) return null;
          return { id: d.id, type: d.type || "image", name: d.name || f };
        } catch { return null; }
      })
      .filter(Boolean);
    materials.sort((a, b) => b.id - a.id); // most recent first (id is a monotonic timestamp)
    const offset = params.offset || 0;
    const limit = params.limit || 50;
    return materials.slice(offset, offset + limit);
  } catch { return []; }
}

// Real OpenRouter model IDs — no alias layer, mirroring irona-chat's
// OR_VIDEO_MODELS (backend/services/videoGeneration.service.ts). Keep these in
// sync with that list.
//
// Per-model capability rules (durations, aspect ratios, last_frame support,
// input_references caps) are deliberately NOT duplicated here. The openrouter
// connector owns them server-side via MODEL_VIDEO_CONFIGS / capInputReferences,
// so this CLI passes arguments straight through and lets the connector
// validate and cap — one source of truth, no client/server drift.
const OR_VIDEO_MODELS = [
  "x-ai/grok-imagine-video",
  "kwaivgi/kling-v3.0-pro",
  "bytedance/seedance-2.0",
  "alibaba/happyhorse-1.1",
];
const OR_IMAGE_MODELS = [
  "google/gemini-3.1-flash-image-preview",
];
// Matches irona-chat's DEFAULT_MODEL in videoGeneration.service.ts.
const DEFAULT_VIDEO_MODEL = "x-ai/grok-imagine-video";
const DEFAULT_IMAGE_MODEL = "google/gemini-3.1-flash-image-preview";

// OpenRouter pricing estimates (USD per unit), keyed on the same real IDs.
// Display-only, for "credit estimate" — the server does the real billing.
const OR_PRICING = {
  "x-ai/grok-imagine-video":   { type: "video", perSecond: 0.040 },
  "kwaivgi/kling-v3.0-pro":    { type: "video", perSecond: 0.045 },
  "bytedance/seedance-2.0":    { type: "video", perSecond: 0.035 },
  "alibaba/happyhorse-1.1":    { type: "video", perSecond: 0.035 },
  "google/gemini-3.1-flash-image-preview": { type: "image", flat: 0.020 },
};

// Slug-tolerant resolver, mirroring irona-chat's resolveToORModel(): accepts a
// full "provider/model" path or a bare "model" slug and expands it to the full
// OpenRouter ID. Returns undefined for anything unrecognized — this is a
// normalizer, not an alias layer, so it never invents a mapping.
function resolveToORModel(model) {
  if (!model) return undefined;
  const known = [...OR_VIDEO_MODELS, ...OR_IMAGE_MODELS];
  if (known.includes(model)) return model;
  const slug = model.includes("/") ? model.split("/").slice(1).join("/") : model;
  return known.find(m => m.split("/").slice(1).join("/") === slug);
}

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
  async request(method, path, body, opts = {}) {
    const url = `${this.baseUrl}${path}`;
    const headers = { ...this.buildAuthHeaders() };
    if (body) headers["Content-Type"] = "application/json";
    const resp = await fetch(url, { method, headers, body: body ? JSON.stringify(body) : void 0, signal: opts.signal });
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
  // ---- MCP call (routes through IronLabs backend → external connector) ----
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
      if (resp.status === 402) {
        throw new InsufficientCreditError({
          available: err.available ?? err.error?.available,
          required: err.required ?? err.error?.required,
          message: err.message || err.error?.message,
        });
      }
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
    // The backend enforces the balance check inside the tool call itself and reports a
    // rejection as a normal 200 response with isError:true (MCP protocol), not an HTTP
    // 402 — the `!resp.ok` branch above never sees it. Without this check, an
    // insufficient-balance rejection here silently looks like a successful call whose
    // JSON.parse just happened to fail.
    if (result.result?.isError) {
      // Matches the wording the backend actually throws today (InsufficientBalanceError:
      // "Insufficient balance: current=... cents, ...") plus plausible variants ("insufficient
      // credits", "insufficient funds") in case that phrasing drifts — this is plain text
      // extracted from a rendered error message, not a structured field, so it's matched
      // loosely on purpose rather than pinned to one exact string.
      if (/insufficient (balance|credits?|funds)/i.test(textContent.text)) {
        throw new InsufficientCreditError({ message: textContent.text });
      }
      // Tool-level failures (e.g. "missing required argument", "prompt exceeds
      // the maximum allowed length") come back as isError:true with the real
      // reason in textContent.text — surface it directly instead of letting it
      // fall through to the JSON.parse fallback below, which would silently
      // wrap it as { text: ... } and produce a misleading generic error
      // downstream (e.g. "did not return a generation id").
      throw new ApiError(400, result.result, textContent.text);
    }
    try { return JSON.parse(textContent.text); } catch { return { text: textContent.text }; }
  }
  // ---- Credit ----
  async getMe(opts = {}) {
    const data = await this.request("GET", "/chat/balance", undefined, opts);
    const raw = data.data?.totalBalance ?? data.balance;
    if (raw == null || (typeof raw === "string" && raw.trim() === "")) {
      throw new ApiError(500, data, "Balance response did not include a totalBalance value");
    }
    const dollars = typeof raw === "string" ? Number(raw) : raw;
    if (typeof dollars !== "number" || !Number.isFinite(dollars)) {
      throw new ApiError(500, data, "Balance response did not include a valid totalBalance value");
    }
    // totalBalance is in dollars; normalize to cents.
    const balance = Math.round(dollars * 100);
    return { user: { id: "ironlabs-user", balance }, balance };
  }
  async estimateCost(params = {}) {
    // Only fall back to a default model when none was given — an unrecognized
    // model should surface as "no pricing data", not silently reprice against
    // the default model.
    let model;
    if (!params.model) {
      model = DEFAULT_VIDEO_MODEL;
    } else {
      model = resolveToORModel(params.model) ?? (params.model.includes("/") ? params.model : null);
      if (!model) return { credits: 0, note: `No pricing data for ${params.model}` };
    }
    const pricing = OR_PRICING[model];
    if (!pricing) return { credits: 0, note: `No pricing data for ${model || "unknown model"}` };
    const usd = pricing.type === "video"
      ? (parseInt(params.duration) || 5) * pricing.perSecond
      : pricing.flat;
    return { credits: Math.ceil(usd * 100), usd: parseFloat(usd.toFixed(4)), model };
  }
  // ---- Task ----
  isImageModel(model) {
    if (!model) return false;
    const resolved = resolveToORModel(model);
    if (resolved) return OR_IMAGE_MODELS.includes(resolved);
    // Unrecognized full provider/model path: fall back to a name heuristic so
    // an arbitrary OpenRouter image model still routes to image_generate.
    return ["gemini", "flux", "ideogram", "gpt-image", "imagen"].some(k => model.includes(k));
  }
  mapModel(model, isImage) {
    if (!model) return isImage ? DEFAULT_IMAGE_MODEL : DEFAULT_VIDEO_MODEL;
    const resolved = resolveToORModel(model);
    if (resolved) return resolved;
    // Advanced escape hatch: any full provider/model path goes through as-is.
    if (model.includes("/")) return model;
    // A bare slug we don't recognize is almost always a typo — failing loudly
    // beats silently generating (and billing) against the default model.
    throw new ApiError(400, {}, `Unknown model "${model}". Pass a full OpenRouter model id — video: ${OR_VIDEO_MODELS.join(", ")}; image: ${OR_IMAGE_MODELS.join(", ")}.`);
  }
  async createTask(params) {
    const isImage = this.isImageModel(params.model);
    // Resolve material data URIs from local store
    if (params.materials?.length) {
      for (const mat of params.materials) {
        let matData = null;
        if (mat.id) matData = readMaterial(mat.id);
        else if (mat.user_asset_id) matData = readMaterial(`asset-${mat.user_asset_id}`);
        else if (mat.character_id) matData = readMaterial(`char-${mat.character_id}`);
        if (matData) mat._dataUri = matData.dataUri || matData.url;
      }
    }
    const taskId = nextId();
    const model = this.mapModel(params.model, isImage);
    const { credits: estimatedCredit } = await this.estimateCost({ model: params.model, duration: params.duration });
    if (isImage) {
      // image_generate via openrouter connector — returns a chat-completion with image modality
      const orArgs = {
        prompt: params.prompt,
        model,
      };
      // The connector's image_generate takes size as a "1536x1024" or "16:9"
      // hint — pass the ratio through rather than pre-converting to pixels.
      if (params.ratio) orArgs.size = params.ratio;
      // Deterministic seed: the connector keys its generation cache on the exact
      // tool arguments, so an unset seed makes every repeat request a cache miss
      // and a fresh (differently-priced) generation. Pass --seed to get the same
      // image back for free on a re-run.
      if (params.seed !== undefined) orArgs.seed = params.seed;
      // image-to-image: pass a reference image if provided
      const imageRef = params.materials?.find(m => m.role === "ref_image" || m.role === "first_frame");
      if (imageRef?._dataUri) orArgs.image_url = imageRef._dataUri;
      if (params.resolution) {
        console.error(`Note: --resolution has no effect on image generation — image size is controlled by --ratio. Ignoring "${params.resolution}".`);
      }
      console.log(`Generating image via OpenRouter connector (${model})...`);
      const orResult = await this.mcpCall("openrouter", "image_generate", orArgs);
      // Extract image URL from the chat-completion response (modalities:
      // image+text). Handles both shapes irona-chat handles: OpenRouter puts
      // generated images in message.images[], while some responses carry them
      // as an image_url part inside message.content[].
      const choice = orResult.choices?.[0]?.message;
      let imageUrl = null;
      const img = choice?.images?.[0];
      if (img) imageUrl = img.image_url?.url ?? img.url ?? null;
      if (!imageUrl && Array.isArray(choice?.content)) {
        const imgPart = choice.content.find(p => p.type === "image_url");
        imageUrl = imgPart?.image_url?.url ?? null;
      }
      if (!imageUrl) throw new ApiError(500, orResult, "OpenRouter connector did not return an image");
      await refreshBalanceCache(this);
      const stored = {
        taskId, status: "completed",
        model, prompt: params.prompt,
        tags: params.tags || [],
        videoUrl: null, imageUrl, orResult,
      };
      writeTask(taskId, stored);
      return { task: { id: taskId, status: "completed", estimatedCredit } };
    } else {
      // video_submit via openrouter connector — async, returns { id, polling_url, status }
      // image_url is optional: omit it for pure text-to-video.
      const firstFrame = params.materials?.find(m => m.role === "first_frame");
      const lastFrame  = params.materials?.find(m => m.role === "last_frame");
      const refImages  = params.materials?.filter(m => m.role === "ref_image") || [];
      const refVideo   = params.materials?.find(m => m.role === "ref_video");
      const orArgs = {
        prompt: params.prompt,
        model,
      };
      if (firstFrame?._dataUri) {
        orArgs.image_url = firstFrame._dataUri;
      } else if (refImages[0]?._dataUri) {
        // No explicit first_frame: fall back to the first ref_image as image_url,
        // preserving the previously-working single-reference behavior even if
        // reference_image_urls below is ignored by the connector.
        orArgs.image_url = refImages[0]._dataUri;
      }
      if (lastFrame?._dataUri) orArgs.last_image_url = lastFrame._dataUri;
      if (refImages.length) {
        // Passed through unconditionally. The connector's video_submit knows
        // each model's supportsInputReferences / maxInputReferences and caps
        // (or drops) the list itself via capInputReferences — deciding that
        // here would just re-create the client/server drift this port removes.
        orArgs.reference_image_urls = refImages.map(m => m._dataUri).filter(Boolean);
      }
      if (refVideo) {
        throw new ApiError(400, {}, `ref_video is not supported — the video connector has no video-input field on any model. For continuity, extract a tail frame with ffmpeg and pass it as --materials "ID:first_frame" instead.`);
      }
      if (params.duration) orArgs.duration = parseInt(params.duration);
      if (params.ratio)    orArgs.aspect_ratio = params.ratio;
      if (params.resolution) {
        // Video models top out at 1080p — "4k" is accepted for convenience but downgraded.
        const resMap = { "1k": "720p", "2k": "1080p", "4k": "1080p" };
        const resolved = resMap[params.resolution] || params.resolution;
        if (params.resolution === "4k") {
          console.error(`Note: video models support up to 1080p — "4k" will render at 1080p, not 4k.`);
        }
        orArgs.resolution = resolved;
      }
      console.log(`Submitting video via OpenRouter connector (${model})...`);
      const submitResult = await this.mcpCall("openrouter", "video_submit", orArgs);
      const generationId = submitResult.id;
      if (!generationId) throw new ApiError(500, submitResult, "OpenRouter connector did not return a generation id");
      await refreshBalanceCache(this);
      const stored = {
        taskId, status: "pending",
        model, prompt: params.prompt,
        tags: params.tags || [],
        videoUrl: null, imageUrl: null,
        _openrouterId: generationId,
      };
      writeTask(taskId, stored);
      return { task: { id: taskId, status: "pending", estimatedCredit } };
    }
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
  async waitForTask(id, maxWaitMs = 600_000) {
    const result = readTask(id);
    if (!result) throw new ApiError(404, {}, `Task #${id} not found`);
    if (result.status === "completed") return result;
    // Video task: poll via openrouter connector until terminal
    const generationId = result._openrouterId;
    if (!generationId) throw new ApiError(500, {}, `Task #${id} has no generation ID to poll`);
    const start = Date.now();
    while (Date.now() - start < maxWaitMs) {
      const remaining = maxWaitMs - (Date.now() - start);
      await new Promise(r => setTimeout(r, Math.min(10_000, remaining))); // poll every 10s, capped by remaining timeout
      const poll = await this.mcpCall("openrouter", "video_status", { id: generationId });
      process.stderr.write(`  Status: ${poll.status || "unknown"}... (${Math.round((Date.now() - start) / 1000)}s elapsed)\n`);
      if (poll.status === "completed") {
        result.status = "completed";
        result.videoUrl = poll.unsigned_urls?.[0] || null;
        result.orResult = poll;
        writeTask(id, result);
        await refreshBalanceCache(this);
        return result;
      }
      if (poll.status === "failed") {
        throw new ApiError(500, poll, `Video generation failed: ${poll.error || "unknown error"}`);
      }
    }
    throw new ApiError(408, {}, `Video generation timed out after ${maxWaitMs / 1000}s`);
  }
  // ---- Material ----
  async uploadMaterial(file, filename, type = "image") {
    const matId = nextId();
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
    const matId = nextId();
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
    const matId = nextId();
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
  async createAssetGroup() { return { group: { id: nextId(), name: "default" } }; }
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
var DEFAULT_BASE_URL = "https://www.chat.ironlabs.ai/api/v1";

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
  credit      Check balance and estimate task cost

Environment:
  IRONLABS_API_KEY   IronLabs API key — all requests (balance, generation, uploads)
                     Get one at https://studio.ironlabs.ai → API Keys
  IRONLABS_BASE_URL  (optional) Full API base URL
                     Default: https://www.chat.ironlabs.ai/api/v1

Global Flags:
  --base-url <url>   Override API base URL for this command

Run "ironlabs <domain> help" for domain-specific commands.

Note: generation routes through the IronLabs OpenRouter connector — only IRONLABS_API_KEY needed.
      Image tasks complete synchronously: task create/result already have the final image.
      Video tasks are async: task create returns immediately with status "pending" — use
      task wait <id> (or task generate, which is create+wait in one step) to block until done.
      Results are cached locally in ~/.ironlabs/tasks/.
      Materials are stored locally in ~/.ironlabs/materials/.
`.trim();
var HELP_TASK = `
ironlabs task — Manage generation tasks

Commands:
  generate                    Create task + wait for result (one step)
  create                      Create a task. Images: completes synchronously. Videos:
                               returns immediately with status "pending" — call task wait
                               (or task generate) to actually block until the video is done.
  list                        List local tasks
  get <id>                    Get task detail
  result <id>                 Get the cached task result as-is (does NOT wait — for a
                               still-pending video task this returns no videoUrl yet)
  wait <id> [--timeout <s>]   Wait for task to finish (instant if already done, otherwise
                               polls; default timeout 600s)
  cancel <id>                 Cancel a task (no-op for synchronous tasks)
  chain <id>                  Download completed task result → upload as material (first_frame chaining)
  tags                        List all your tags
  tag <id> --tags a,b,c       Update tags on a task

Options for generate/create:
  --prompt <text>             (required) Generation prompt
  --model <id>                OpenRouter model id (default: x-ai/grok-imagine-video).
                               A bare slug is accepted and expanded, e.g. "seedance-2.0"
                               → "bytedance/seedance-2.0".
  --duration <seconds>        Video duration (default: 5)
  --ratio <w:h>               Aspect ratio (default: 1:1)
  --resolution <1k|2k|4k>     Image resolution (image models)
  --seed <int>                Deterministic seed (image models). The connector caches on the
                               exact request, so reusing a seed replays the same image for free
                               instead of re-generating. Omit for a fresh random result.
  --tags <a,b,c>              Comma-separated tags
  --materials <spec>          Material refs: "id:role" or "id1:role1,id2:role2"
                               Roles: ref_image, first_frame, last_frame
                               ref_image: bind each to @Image1, @Image2, ... tokens in --prompt,
                               in upload order. The connector caps the count per model.

Options for generate/wait:
  --timeout <seconds>          Max time to poll a pending video task (default: 600)

Models (real OpenRouter ids — no aliases):
  Video (async; poll with task wait)
    x-ai/grok-imagine-video     (default)
    kwaivgi/kling-v3.0-pro
    bytedance/seedance-2.0
    alibaba/happyhorse-1.1
  Image (synchronous)
    google/gemini-3.1-flash-image-preview
  (any other full OpenRouter model path is passed through as-is)

Note: all generation goes through the IronLabs image/video connector
      (image_generate / video_submit / video_status). Per-model capability rules —
      which models accept a last_frame, how many ref_image references they take —
      are enforced by the connector, not by this CLI, so an unsupported combination
      comes back as a clear error from the server rather than being silently dropped
      here. Video continuation from an existing clip is not supported by any model;
      extract a tail frame with ffmpeg and pass it as first_frame instead.

Examples:
  ironlabs task generate --prompt "a cat dancing" --duration 5
  ironlabs task generate --prompt "cute cat" --model google/gemini-3.1-flash-image-preview --resolution 2k
  ironlabs task generate --prompt "hero product shot" --model gemini-3.1-flash-image-preview --ratio 16:9
  ironlabs task create --prompt "epic scene" --duration 10 --ratio 16:9 --model bytedance/seedance-2.0
  ironlabs task wait 1234567890 --timeout 300
  ironlabs task list --status completed --limit 5
  ironlabs task result 1234567890
  ironlabs task chain 1234567890

  # Multi-reference (@Image1/@Image2 binding):
  IMG1=$(node ironlabs-cli.mjs material upload girl.jpg | jq -r '.material.id')
  IMG2=$(node ironlabs-cli.mjs material upload hallway.jpg | jq -r '.material.id')
  node ironlabs-cli.mjs task generate \\
    --prompt "@Image1 walks down the hallway, @Image2 visible in the background" \\
    --materials "\${IMG1}:ref_image,\${IMG2}:ref_image"

  # Reproducible image — same seed replays the cached result, no new spend:
  node ironlabs-cli.mjs task generate --model google/gemini-3.1-flash-image-preview \\
    --prompt "hero product shot on white" --ratio 16:9 --seed 0
`.trim();
var HELP_MATERIAL = `
ironlabs material — Manage materials

Commands:
  list                        List your uploaded materials
  upload <file>               Upload a material (image or video)

Options for list:
  --type <image|video>        Filter by type
  --limit <n>                 Max results (default: 20)
  --offset <n>                Skip first n results (default: 0)

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
ironlabs credit — Balance and cost estimation

Commands:
  me                          Show current user balance
  estimate                    Estimate task cost by model and duration

Options for estimate:
  --model <id>                OpenRouter model id (default: x-ai/grok-imagine-video)
  --duration <seconds>        Video duration for video models (default: 5)

Examples:
  ironlabs credit me
  ironlabs credit estimate --model bytedance/seedance-2.0 --duration 10
  ironlabs credit estimate --model google/gemini-3.1-flash-image-preview
`.trim();
async function taskGenerate(client, flags) {
  if (!flags.prompt) {
    console.error("Error: --prompt is required.\n");
    console.log(HELP_TASK);
    process.exit(1);
  }
  const params = buildCreateParams(flags);
  console.error("Creating task...");
  const { task } = await client.createTask(params);
  console.error(`Task #${task.id} created (${task.status}).`);
  const maxWaitMs = flags.timeout ? parseInt(flags.timeout) * 1000 : undefined;
  const result = await client.waitForTask(task.id, maxWaitMs);
  console.error("Done!");
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
  console.error(`Task created: id=${data.task.id}, status=${data.task.status}`);
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
async function taskWait(client, positional, flags) {
  const id = parseInt(positional[0]);
  if (!id) {
    console.error("Error: task ID required.\nUsage: ironlabs task wait <id> [--timeout <seconds>]");
    process.exit(1);
  }
  console.error(`Task #${id}: waiting for completion (instant if already done, polls if still pending)...`);
  const maxWaitMs = flags.timeout ? parseInt(flags.timeout) * 1000 : undefined;
  const result = await client.waitForTask(id, maxWaitMs);
  console.error("Done!");
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
    console.error("Error: task ID required.\nUsage: ironlabs task chain <id>\n\nDownloads a completed task result and re-uploads it as a material — an image becomes a ref_image/first_frame.");
    process.exit(1);
  }
  console.error(`Getting result for task #${id}...`);
  const result = await client.getTaskResult(id);
  const url = result.videoUrl || result.imageUrl;
  if (!url) {
    console.error(`Task #${id} has no video or image result.`);
    process.exit(1);
  }
  const isVideo = !!result.videoUrl;
  const ext = isVideo ? "mp4" : "png";
  const tmpPath = join(os.tmpdir(), `chain-${id}.${ext}`);
  console.error(`Downloading ${isVideo ? "video" : "image"} to ${tmpPath}...`);
  // Video URLs from OpenRouter require gateway auth — use video_download connector
  let arrayBuf;
  if (isVideo) {
    const dlResult = await client.mcpCall("openrouter", "video_download", { url });
    if (!dlResult.data_base64) throw new Error("video_download returned no data");
    arrayBuf = Buffer.from(dlResult.data_base64, "base64");
    // video_download hits the same billable connector as generation — refresh in case it's metered too.
    await refreshBalanceCache(client);
  } else {
    const resp = await fetch(url);
    if (!resp.ok) throw new Error(`Download failed: ${resp.status}`);
    arrayBuf = Buffer.from(await resp.arrayBuffer());
  }
  writeFileSync(tmpPath, arrayBuf);
  console.error(`Downloaded: ${(arrayBuf.byteLength / 1024 / 1024).toFixed(1)}MB`);
  const type = isVideo ? "video" : "image";
  const buffer = readFileSync(tmpPath);
  const filename = `chain-${id}.${ext}`;
  console.error(`Uploading as ${type} material...`);
  const data = await client.uploadMaterial(buffer, filename, type);
  const matId = data.material?.id || data.id;
  console.error(`\nMaterial #${matId} ready.`);
  if (isVideo) {
    console.error(`Note: no video model accepts a video input, so this clip can't be continued directly. For continuity, extract a tail frame with ffmpeg and upload that as --materials "ID:first_frame" instead.`);
  } else {
    console.error(`Use as: --materials "${matId}:ref_image"`);
  }
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
    offset: flags.offset ? parseInt(flags.offset) : 0,
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
function buildCreateParams(flags) {
  const params = { prompt: flags.prompt };
  if (flags.model) params.model = flags.model;
  if (flags.duration) params.duration = parseInt(flags.duration);
  if (flags.ratio) params.ratio = flags.ratio;
  if (flags.resolution) params.resolution = flags.resolution;
  if (flags.seed !== undefined && flags.seed !== "true") {
    const seed = parseInt(flags.seed);
    if (Number.isNaN(seed)) {
      console.error(`Error: --seed must be an integer, got "${flags.seed}".`);
      process.exit(1);
    }
    params.seed = seed;
  }
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
        allMaterials.push({ id: parseInt(id), role: role || "ref_image" });
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
  console.error(`Task #${result.taskId}  ${result.status}`);
  if (result.videoUrl) console.error(`  Video: ${result.videoUrl}`);
  if (result.imageUrl) console.error(`  Image: ${result.imageUrl}`);
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
    const client = createClient(flags["base-url"], true);
    json(await client.estimateCost({ model: flags.model, duration: flags.duration }));
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
          case "me": await creditMe(client); break;
          // "estimate" is handled earlier (before client/auth setup) since it's pure local math.
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
      // Some rejections (e.g. from the MCP connector call) only carry a preformatted
      // message, not a numeric breakdown — skip the redundant "0, 0" line then.
      if (e.available || e.required) {
        console.error(`  Available: ${e.available}, Required: ${e.required}`);
      }
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
