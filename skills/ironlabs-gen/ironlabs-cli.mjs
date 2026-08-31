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

// File-type detection for uploads. Kept in one place because the material,
// character and asset paths all need the same answers — they each derived them
// inline before, and the three copies of the video-extension list drifted in
// both formatting and order.
const VIDEO_EXTENSIONS = ["mp4", "mov", "avi", "webm", "mkv"];

// Accepts a bare filename or a full path. Returns the lowercase extension with
// no leading dot, falling back to "jpg" for an extensionless name.
function fileExtension(nameOrPath) {
  return extname(nameOrPath).slice(1).toLowerCase() || "jpg";
}

function isVideoFile(nameOrPath) {
  return VIDEO_EXTENSIONS.includes(fileExtension(nameOrPath));
}

// An explicit `type` (from --type, or a caller that already resolved it) wins:
// the extension is only a guess, and the caller may know better.
function mimeTypeFor(nameOrPath, type) {
  if (type === "video") return "video/mp4";
  const ext = fileExtension(nameOrPath);
  return ext === "png" ? "image/png"
    : ext === "webp" ? "image/webp"
    : "image/jpeg";
}

// Best-effort: the generation this record describes has already finished and
// been billed, so a failed write must not turn it into a hard error. It is not
// swallowed silently, though — this file is the only copy of the result URL, so
// `task generate` would otherwise fail with a bare "Task not found" from the
// waitForTask read that follows. Returns false so the caller can print the URL.
function writeTask(id, data) {
  try {
    mkdirSync(TASK_DIR, { recursive: true });
    writeFileSync(join(TASK_DIR, `${id}.json`), JSON.stringify(data));
    return true;
  } catch (e) {
    console.error(`Warning: could not save task #${id} to ${TASK_DIR} (${e?.message || e}). The generation succeeded, but "task result ${id}" will not find it.`);
    return false;
  }
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
// Best-effort for the same reason as writeTask — the upload already happened.
// Warned rather than swallowed because the id handed back to the user would
// otherwise look valid while every later `--materials <id>` reference fails to
// resolve it.
function writeMaterial(id, data) {
  try {
    mkdirSync(MATERIAL_DIR, { recursive: true });
    writeFileSync(join(MATERIAL_DIR, `${id}.json`), JSON.stringify(data));
    return true;
  } catch (e) {
    console.error(`Warning: could not save material ${id} to ${MATERIAL_DIR} (${e?.message || e}). Referencing it later with --materials will fail.`);
    return false;
  }
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

// Real model IDs, mirroring irona-chat's OR_VIDEO_MODELS
// (backend/services/videoGeneration.service.ts) and the model list documented on
// the image_generate / video_generate connector tools. Keep in sync with those.
//
// Per-model capability rules (durations, aspect ratios, MuAPI-vs-OpenRouter
// routing) are deliberately NOT duplicated here — the connector owns them
// server-side, so this CLI passes arguments through and lets the server decide.
// One entry per model: its type and its pricing estimate. This is the single
// place a model is declared — the video/image lists below are derived from it,
// so adding a model here cannot leave it priced-but-unroutable or
// routable-but-unpriced, which is what two hand-maintained lists allowed.
//
// Pricing is USD per unit and display-only, for "credit estimate" — the server
// reports the real figure as cost_usd, and that is what gets billed.
// gemini-3.1-flash-image-preview (0.060) and grok-imagine-image-quality (0.050)
// are measured against returned cost_usd; the rest are rough placeholders, so
// treat "credit estimate" as indicative only.
//
// The video perSecond figures are known to understate badly: a measured 5s
// bytedance/seedance-2.0 render billed $0.815 ($0.163/s), ~4.6x the 0.035 here.
// They are left as-is deliberately — the real price comes back from MuAPI per
// job (cost.amount_usd) and varies with resolution and tier, so no local table
// can be authoritative. Video estimates therefore carry an explicit warning
// rather than a fabricated-precision number.
const OR_MODELS = {
  "bytedance/seedance-2.0":    { type: "video", perSecond: 0.035 },
  "x-ai/grok-imagine-video":   { type: "video", perSecond: 0.040 },
  "kwaivgi/kling-v3.0-pro":    { type: "video", perSecond: 0.045 },
  "alibaba/happyhorse-1.1":    { type: "video", perSecond: 0.035 },
  "google/gemini-3.1-flash-image-preview": { type: "image", flat: 0.060 },
  "google/gemini-3.1-flash-lite-image":    { type: "image", flat: 0.030 },
  "google/gemini-3-pro-image-preview":     { type: "image", flat: 0.120 },
  "google/gemini-2.5-flash-image":         { type: "image", flat: 0.040 },
  "x-ai/grok-imagine-image-quality":       { type: "image", flat: 0.050 },
  "bytedance-seed/seedream-4.5":           { type: "image", flat: 0.050 },
};
// Declaration order is preserved, so the first entry of each type is the
// default and these read in the same order the help text prints them.
const OR_MODEL_IDS = Object.keys(OR_MODELS);
const OR_VIDEO_MODELS = OR_MODEL_IDS.filter(m => OR_MODELS[m].type === "video");
const OR_IMAGE_MODELS = OR_MODEL_IDS.filter(m => OR_MODELS[m].type === "image");

// Matches DEFAULT_MODEL in irona-chat's agentVideoGeneration.service.ts /
// agentImageGeneration.service.ts — the defaults the connector itself applies.
const DEFAULT_VIDEO_MODEL = "bytedance/seedance-2.0";
const DEFAULT_IMAGE_MODEL = "google/gemini-3.1-flash-image-preview";

// Upper bound on a single generate call. Generous enough for a slow video
// render, but finite: fetch() has no timeout of its own, so without this a
// stalled connection would hang the CLI indefinitely.
const MCP_CALL_TIMEOUT_MS = 900_000;

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
  // ---- MCP call (IronLabs "generate" toolset: image_generate / video_generate) ----
  // Hits the same external MCP endpoint irona-chat exposes for its image/video
  // connectors (backend/constants/externalMcpToolsets.constants.ts), so a
  // generation from here runs the identical server-side chain the chat app runs:
  // exact cache → semantic cache → MuAPI → OpenRouter fallback.
  //
  // Authenticates with IRONLABS_API_KEY directly. The older /ext/token sandbox
  // token is deliberately not used: its scope allowlist has no "image"/"video"
  // entry, so a token for these connectors can't be minted at all.
  async mcpCall(toolName, toolArguments, timeoutMs = MCP_CALL_TIMEOUT_MS) {
    const url = `${this.baseUrl}/mcp/ext/generate`;
    let resp;
    try {
      resp = await fetch(url, {
        method: "POST",
        headers: { Authorization: `Bearer ${this.apiKey}`, "Content-Type": "application/json", Accept: "application/json, text/event-stream" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: toolName, arguments: toolArguments } }),
        // These calls block for the whole render and fetch() has no timeout of
        // its own, so without this a stalled connection hangs the CLI forever.
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (e) {
      if (e?.name === "TimeoutError" || e?.name === "AbortError") {
        throw new ApiError(504, {}, `${toolName} did not respond within ${Math.round(timeoutMs / 1000)}s — giving up. The job may still be running and billed upstream. Retry, or use a shorter --duration.`);
      }
      // A generation that outlives the server's request budget shows up here as
      // a socket abort mid-stream, not as an HTTP status. Report it as the
      // timeout it is instead of dumping a raw undici stack trace.
      throw new ApiError(504, { cause: String(e?.cause?.message || e?.message || e) }, `The connection to ${toolName} dropped before a result arrived — the server closed the stream mid-generation, which usually means the render outran the request budget. The job may still have run and been billed upstream. Retry, or use a shorter --duration.`);
    }
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
    // The response headers land as soon as the stream opens, long before the
    // generation finishes, so a render that outruns the server's request budget
    // surfaces here — either as a torn body read or as a 200 with no event at
    // all. Both mean the same thing; report it as the timeout it is rather than
    // letting a raw undici stack escape.
    const streamCutError = () => new ApiError(504, {}, `${toolName} returned no result — the server closed the stream mid-generation, which usually means the render outran its request budget. The job may still have run and been billed upstream. Retry, or use a shorter --duration.`);
    if (contentType.includes("text/event-stream")) {
      let text;
      try {
        text = await resp.text();
      } catch {
        throw streamCutError();
      }
      const dataLine = text.split("\n").find(l => l.startsWith("data:"));
      if (!dataLine) throw streamCutError();
      result = JSON.parse(dataLine.slice(5).trim());
    } else {
      try {
        result = await resp.json();
      } catch {
        throw streamCutError();
      }
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
    const pricing = OR_MODELS[model];
    if (!pricing) return { credits: 0, note: `No pricing data for ${model || "unknown model"}` };
    const usd = pricing.type === "video"
      ? (parseInt(params.duration) || 10) * pricing.perSecond // 10s matches the connector's own duration default
      : pricing.flat;
    const estimate = { credits: Math.ceil(usd * 100), usd: parseFloat(usd.toFixed(4)), model };
    // Video rates are unmeasured placeholders that have been observed to
    // understate the billed figure several-fold — say so rather than let the
    // number read as a quote.
    if (pricing.type === "video") {
      estimate.note = "Indicative only — video rates are unverified placeholders and have measured several times low. Actual cost is whatever the server returns as costUsd.";
    }
    return estimate;
  }
  // ---- Task ----
  isImageModel(model) {
    if (!model) return false;
    const resolved = resolveToORModel(model);
    if (resolved) return OR_IMAGE_MODELS.includes(resolved);
    // The name heuristic is scoped to a full provider/model path, matching
    // mapModel's escape hatch: that is the only unrecognized input that gets
    // routed rather than rejected, so it is the only one worth guessing a type
    // for. A bare unrecognized slug is a typo mapModel throws on moments later
    // — guessing "image" for it would just decide how a doomed request is
    // shaped, and would quietly become a real mis-route if that throw ever
    // softened into a fallback.
    if (!model.includes("/")) return false;
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
    throw new ApiError(400, {}, `Unknown model "${model}". Pass a full provider/model id — video: ${OR_VIDEO_MODELS.join(", ")}; image: ${OR_IMAGE_MODELS.join(", ")}.`);
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
    // Only send `model` when the caller actually chose one. Omitting it lets the
    // connector apply its own default AND run its cross-model cache peek, which
    // it skips entirely whenever a model is supplied — pinning the default here
    // would silently cost every user that cache tier.
    const model = params.model ? this.mapModel(params.model, isImage) : undefined;
    const effectiveModel = model ?? (isImage ? DEFAULT_IMAGE_MODEL : DEFAULT_VIDEO_MODEL);
    const { credits: estimatedCredit } = await this.estimateCost({ model: params.model, duration: params.duration });
    if (isImage) {
      // image_generate — synchronous; returns { images: [url], source, model, cost_usd }
      const orArgs = { prompt: params.prompt };
      if (model) orArgs.model = model;
      // The cache is keyed on the user's own wording, not on an expanded prompt,
      // so passing it through is what lets this share cache hits with the chat app.
      if (params.userPrompt) orArgs.user_prompt = params.userPrompt;
      if (params.ratio) orArgs.aspect_ratio = params.ratio;
      if (params.quantity) orArgs.quantity = params.quantity;
      // image-to-image: pass a reference image if provided
      const imageRef = params.materials?.find(m => m.role === "ref_image" || m.role === "first_frame");
      if (imageRef?._dataUri) orArgs.image_url = imageRef._dataUri;
      if (params.resolution) {
        console.error(`Note: --resolution has no effect on image generation — image size is controlled by --ratio. Ignoring "${params.resolution}".`);
      }
      console.error(`Generating image via the IronLabs image connector (${effectiveModel})...`);
      const orResult = await this.mcpCall("image_generate", orArgs);
      const imageUrl = orResult.images?.[0] ?? null;
      if (!imageUrl) throw new ApiError(500, orResult, "The image connector did not return an image");
      await refreshBalanceCache(this);
      const stored = {
        taskId, status: "completed",
        model: orResult.model || effectiveModel, prompt: params.prompt,
        tags: params.tags || [],
        videoUrl: null, imageUrl,
        source: orResult.source, costUsd: orResult.cost_usd,
        orResult,
      };
      // The stored record is the only copy of the URL, so surface it directly
      // if it could not be written rather than losing a paid-for result.
      if (!writeTask(taskId, stored)) console.error(`Image URL: ${imageUrl}`);
      console.error(`Done — served from ${orResult.source} ($${orResult.cost_usd}).`);
      return { task: { id: taskId, status: "completed", estimatedCredit } };
    } else {
      // video_generate — synchronous; returns { url, source, model, cost_usd }.
      // image_url is optional: omit it for pure text-to-video.
      const firstFrame = params.materials?.find(m => m.role === "first_frame");
      const lastFrame  = params.materials?.find(m => m.role === "last_frame");
      const refImages  = params.materials?.filter(m => m.role === "ref_image") || [];
      const refVideo   = params.materials?.find(m => m.role === "ref_video");
      const orArgs = { prompt: params.prompt };
      if (model) orArgs.model = model;
      if (params.userPrompt) orArgs.user_prompt = params.userPrompt;
      if (firstFrame?._dataUri) {
        orArgs.image_url = firstFrame._dataUri;
      } else if (refImages[0]?._dataUri) {
        // No explicit first_frame: use the first ref_image as the hero still.
        orArgs.image_url = refImages[0]._dataUri;
      }
      // The connector's video_generate takes exactly one still (image_url, used as
      // the first frame). There is no multi-reference or last-frame field, so warn
      // instead of silently dropping material the caller attached.
      if (refImages.length > 1) {
        console.error(`Note: the video connector accepts a single reference still — only the first of your ${refImages.length} ref_image materials is used. @Image2/@Image3 prompt tokens will not bind.`);
      }
      if (lastFrame) {
        console.error(`Note: the video connector has no last-frame input — the "last_frame" material is ignored.`);
      }
      if (refVideo) {
        throw new ApiError(400, {}, `ref_video is not supported — the video connector has no video-input field on any model. For continuity, extract a tail frame with ffmpeg and pass it as --materials "ID:first_frame" instead.`);
      }
      if (params.duration) orArgs.duration = parseInt(params.duration);
      if (params.ratio)    orArgs.aspect_ratio = params.ratio;
      if (params.audio !== undefined) orArgs.audio = params.audio;
      if (params.resolution) {
        // Video models top out at 1080p — "4k" is accepted for convenience but downgraded.
        const resMap = { "1k": "720p", "2k": "1080p", "4k": "1080p" };
        const resolved = resMap[params.resolution] || params.resolution;
        if (params.resolution === "4k") {
          console.error(`Note: video models support up to 1080p — "4k" will render at 1080p, not 4k.`);
        }
        orArgs.resolution = resolved;
      }
      console.error(`Generating video via the IronLabs video connector (${effectiveModel})... this call blocks until the render finishes.`);
      const orResult = await this.mcpCall("video_generate", orArgs);
      const videoUrl = orResult.url ?? null;
      if (!videoUrl) throw new ApiError(500, orResult, "The video connector did not return a video URL");
      await refreshBalanceCache(this);
      const stored = {
        taskId, status: "completed",
        model: orResult.model || effectiveModel, prompt: params.prompt,
        tags: params.tags || [],
        videoUrl, imageUrl: null,
        source: orResult.source, costUsd: orResult.cost_usd,
        orResult,
      };
      if (!writeTask(taskId, stored)) console.error(`Video URL: ${videoUrl}`);
      console.error(`Done — served from ${orResult.source} ($${orResult.cost_usd}).`);
      return { task: { id: taskId, status: "completed", estimatedCredit } };
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
  // Both connector tools are synchronous — "generate" only returns once the
  // render is finished — so there is nothing left to poll. This stays as a
  // no-op success purely so existing "generate && wait" scripts keep working.
  async waitForTask(id) {
    const result = readTask(id);
    if (!result) throw new ApiError(404, {}, `Task #${id} not found`);
    if (result.status !== "completed") {
      throw new ApiError(500, {}, `Task #${id} is "${result.status}" — generation is synchronous now, so a non-completed task means the generate call itself failed. Re-run the generate command.`);
    }
    return result;
  }
  // ---- Material ----
  async uploadMaterial(file, filename, type = "image") {
    const matId = nextId();
    const mimeType = mimeTypeFor(filename, type);
    const b64 = Buffer.from(file).toString("base64");

    // Try CDN upload; fall back to an inline data: URI if unavailable. The
    // fallback is serviceable — the connector stages inline references into R2
    // before handing them to MuAPI — but it ships the whole file on every
    // generate call, so a persistent failure here is worth surfacing rather
    // than swallowing.
    let url = null;
    let uploadIssue = null;
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
          if (!url) uploadIssue = "upload succeeded but returned no URL";
        } else {
          uploadIssue = `HTTP ${resp.status}`;
        }
      } catch (e) {
        uploadIssue = e?.message || String(e);
      }
    }
    if (uploadIssue) {
      console.error(`Note: could not host ${filename} at ${this.baseUrl}/upload (${uploadIssue}) — embedding it inline instead. Generation still works; large files will make each generate call slower.`);
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
    // Characters are always stills, so pin the image branch rather than letting
    // a video extension pick video/mp4.
    const mimeType = mimeTypeFor(filename, "image");
    const dataUri = `data:${mimeType};base64,${Buffer.from(file).toString("base64")}`;
    writeMaterial(`char-${matId}`, { id: matId, name: filename, type: "character", dataUri });
    return { character: { id: matId, name: filename }, action: "created" };
  }
  async addCharacterGrant() { return {}; }
  // ---- Asset (stored locally with key "asset-<id>") ----
  async createAsset(file, filename, type = "image") {
    if (!file || !filename) throw new ApiError(400, {}, "Usage: ironlabs asset create <file>");
    const matId = nextId();
    // Unlike uploadMaterial, the extension can promote an asset to video even
    // when the caller left --type at its "image" default.
    const assetType = (type === "video" || isVideoFile(filename)) ? "video" : "image";
    const mimeType = mimeTypeFor(filename, assetType);
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
    // Already gone, or never existed — delete is idempotent here, and the
    // caller only cares that the asset is absent afterwards.
    try { unlinkSync(join(MATERIAL_DIR, `asset-${id}.json`)); } catch {}
    return {};
  }
  async waitForAsset(id) { return this.getAsset(id); }
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
    } catch {
      // No .env at this candidate path, or it isn't readable — try the next
      // one. A missing .env is the normal case when config comes from real
      // environment variables, so this must not be reported as a problem.
    }
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

Note: generation routes through the IronLabs image/video connector — only IRONLABS_API_KEY needed.
      Both image and video tasks complete synchronously: task create/result already have
      the final asset, and "task wait" is a no-op kept for script compatibility.
      Results are cached locally in ~/.ironlabs/tasks/.
      Materials are stored locally in ~/.ironlabs/materials/.
`.trim();
var HELP_TASK = `
ironlabs task — Manage generation tasks

Commands:
  generate                    Create a task and return its finished result
  create                      Same as generate — both image and video complete synchronously
  list                        List local tasks
  get <id>                    Get task detail
  result <id>                 Get the cached task result
  wait <id>                   No-op kept for script compatibility (generation is synchronous)
  cancel <id>                 Cancel a task (no-op for synchronous tasks)
  chain <id>                  Download completed task result → upload as material (first_frame chaining)
  tags                        List all your tags
  tag <id> --tags a,b,c       Update tags on a task

Options for generate/create:
  --prompt <text>             (required) Generation prompt
  --user-prompt <text>        The user's own wording, when --prompt is your expansion of it.
                               The server keys its cache on this, so passing it is what lets
                               a repeat ask hit the cache instead of paying to regenerate.
  --model <id>                Model id. A bare slug is accepted and expanded, e.g.
                               "seedance-2.0" → "bytedance/seedance-2.0". Omitting it means
                               video: the server also checks its cache under the other video
                               models before generating, which it skips once you name one.
                               (Images have no such cross-model check, and need a model here
                               anyway — with no --model the CLI treats the task as video.)
  --duration <seconds>        Video duration (server default: 10)
  --ratio <w:h>               Aspect ratio (server default: 16:9)
  --resolution <1k|2k|4k>     Video resolution — 1k=720p, 2k/4k=1080p (ignored for images)
  --quantity <1-4>            How many images to generate (image models; default 1)
  --no-audio                  Render the video silent. Leave this off unless asked: it scopes
                               the cache key and forces the request off the cheaper MuAPI tier.
  --tags <a,b,c>              Comma-separated tags
  --materials <spec>          Material refs: "id:role" or "id1:role1,id2:role2"
                               Roles: ref_image, first_frame
                               Video takes a single still, used as the first frame. Extra
                               ref_image entries and last_frame are ignored with a warning.

Models:
  Video
    bytedance/seedance-2.0      (default)
    x-ai/grok-imagine-video
    kwaivgi/kling-v3.0-pro
    alibaba/happyhorse-1.1      (not on MuAPI — always billed via OpenRouter)
  Image
    google/gemini-3.1-flash-image-preview   (default)
    google/gemini-3.1-flash-lite-image
    google/gemini-3-pro-image-preview
    google/gemini-2.5-flash-image
    x-ai/grok-imagine-image-quality
    bytedance-seed/seedream-4.5
  (any other full provider/model path is passed through as-is)

Note: all generation goes through the IronLabs image/video connector
      (image_generate / video_generate) — the same endpoint and the same server-side
      chain the chat app uses: exact cache → semantic cache → MuAPI → OpenRouter
      fallback. Each result reports which tier served it; "task result" shows it as
      "source", alongside the real "costUsd". Per-model capability rules are enforced
      server-side, so an unsupported combination comes back as an error from the
      server rather than being silently dropped here. Video continuation from an
      existing clip is not supported; extract a tail frame with ffmpeg and pass it as
      first_frame instead.

Examples:
  ironlabs task generate --prompt "a cat dancing" --duration 5
  ironlabs task generate --prompt "cute cat" --model google/gemini-3.1-flash-image-preview
  ironlabs task generate --prompt "hero product shot" --model gemini-3.1-flash-image-preview --ratio 16:9
  ironlabs task create --prompt "epic scene" --duration 10 --ratio 16:9 --model bytedance/seedance-2.0
  ironlabs task list --status completed --limit 5
  ironlabs task result 1234567890
  ironlabs task chain 1234567890

  # Image-to-image / first-frame chaining:
  IMG=$(node ironlabs-cli.mjs material upload girl.jpg | jq -r '.material.id')
  node ironlabs-cli.mjs task generate \\
    --prompt "she walks down a neon-lit hallway" \\
    --materials "\${IMG}:first_frame"

  # Cache-friendly: pass the user's own wording so a repeat ask is served free.
  node ironlabs-cli.mjs task generate \\
    --user-prompt "give me an owl image" \\
    --prompt "a great horned owl on a branch, photorealistic" \\
    --model google/gemini-3.1-flash-image-preview
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
  --model <id>                Model id (default: bytedance/seedance-2.0)
  --duration <seconds>        Video duration for video models (default: 10)

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
  const result = await client.waitForTask(task.id);
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
async function taskWait(client, positional) {
  const id = parseInt(positional[0]);
  if (!id) {
    console.error("Error: task ID required.\nUsage: ironlabs task wait <id>");
    process.exit(1);
  }
  const result = await client.waitForTask(id);
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
  // Both connectors hand back a plain fetchable link (never inline base64 and
  // never a gateway URL needing auth), so a straight fetch works for both.
  const resp = await fetch(url);
  if (!resp.ok) throw new Error(`Download failed: ${resp.status}`);
  const arrayBuf = Buffer.from(await resp.arrayBuffer());
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
  const type = flags.type || (isVideoFile(filePath) ? "video" : "image");
  const buffer = readFileSync(filePath);
  const filename = basename(filePath);
  console.error(`Uploading ${filename} (${type}, ${(buffer.byteLength / 1024).toFixed(1)}KB)...`);
  const data = await client.uploadMaterial(buffer, filename, type);
  if (data.action === "exists") {
    console.error(`Material already exists: #${data.material.id}`);
  } else {
    console.error(`Material uploaded: #${data.material.id}`);
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
  console.error(`Creating character from ${filename} (${(buffer.byteLength / 1024).toFixed(1)}KB)...`);
  const data = await client.importCharacters(buffer, filename);
  console.error(`Character #${data.character.id} created — use as: --characters "${data.character.id}:reference_image"`);
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
  const type = flags.type || (isVideoFile(filePath) ? "video" : "image");
  const buffer = readFileSync(filePath);
  const filename = basename(filePath);
  console.error(`Creating asset from ${filename} (${type}, ${(buffer.byteLength / 1024).toFixed(1)}KB)...`);
  const data = await client.createAsset(buffer, filename, type);
  console.error(`Asset #${data.asset.id} created — use as: --materials "asset:${data.asset.id}:ref_image"`);
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
  if (flags["user-prompt"]) params.userPrompt = flags["user-prompt"];
  if (flags.quantity !== undefined && flags.quantity !== "true") {
    const quantity = parseInt(flags.quantity);
    if (Number.isNaN(quantity) || quantity < 1 || quantity > 4) {
      console.error(`Error: --quantity must be an integer from 1 to 4, got "${flags.quantity}".`);
      process.exit(1);
    }
    params.quantity = quantity;
  }
  // Left unset by default on purpose: the connector defaults audio on, and
  // pinning it scopes the cache key (a silent request never matches a video
  // already rendered with audio) and forces the request off the MuAPI tier.
  if (flags["no-audio"]) params.audio = false;
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
  // Which tier of the server chain served this, and what it actually cost.
  if (result.source) console.error(`  Source: ${result.source}${result.costUsd !== undefined ? `  ($${result.costUsd})` : ""}`);
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
    console.error(`ℹ️  Using API: ${baseUrlOverride}`);
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
          case "wait":     await taskWait(client, subPositional); break;
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
