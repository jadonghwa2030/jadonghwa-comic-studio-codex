import express from "express";
import dotenv from "dotenv";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({ path: path.join(process.cwd(), ".env.local") });
dotenv.config({ path: path.join(process.cwd(), ".env") });

const PORT = Number.parseInt(process.env.LOCAL_API_PORT || process.env.PORT || "8787", 10);
const JSON_LIMIT = process.env.LOCAL_API_JSON_LIMIT || "50mb";
const PROJECT_ARCHIVE_PATH = path.resolve(
  process.env.LOCAL_PROJECT_ARCHIVE_PATH || path.join(process.cwd(), "local-project-archive", "projects.json")
);
const CODEX_OAUTH_PROXY_PORT = Number.parseInt(
  process.env.CODEX_OAUTH_PROXY_PORT || process.env.OAUTH_PORT || "10531",
  10
);
const CODEX_OAUTH_URL = `http://127.0.0.1:${CODEX_OAUTH_PROXY_PORT}`;
const CODEX_OAUTH_AUTOSTART = !/^(1|true|yes)$/i.test(String(process.env.CODEX_NO_OAUTH_PROXY || ""));
const CODEX_DEFAULT_IMAGE_MODEL = String(process.env.CODEX_IMAGE_MODEL || "gpt-5.5").trim() || "gpt-5.5";
const CODEX_DEFAULT_TEXT_MODEL = String(process.env.CODEX_TEXT_MODEL || "gpt-5.5").trim() || "gpt-5.5";
const CODEX_DEFAULT_MODERATION = String(process.env.CODEX_IMAGE_MODERATION || "low").trim() || "low";
const CODEX_VALID_IMAGE_MODELS = new Set(["gpt-5.5", "gpt-5.4", "gpt-5.4-mini"]);
const GPT_IMAGE_DIMENSION_STEP = 16;
const GPT_IMAGE_MAX_EDGE = 3840;
const GPT_IMAGE_MAX_PIXELS = 8_294_400;
const GPT_IMAGE_MIN_PIXELS = 655_360;
const GPT_IMAGE_MAX_LONG_TO_SHORT_RATIO = 3;

const parseJsonSafe = (value) => {
  if (typeof value !== "string") return null;
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
};

const sanitizeErrorMessage = (message) => String(message || "").replace(/\s+/g, " ").trim().slice(0, 280);

const ensureParentDir = async (filePath) => {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
};

const readProjectArchive = async () => {
  try {
    const raw = await fs.readFile(PROJECT_ARCHIVE_PATH, "utf8");
    const parsed = parseJsonSafe(raw);
    return Array.isArray(parsed?.projects) ? parsed.projects : Array.isArray(parsed) ? parsed : [];
  } catch (e) {
    if (e?.code === "ENOENT") return [];
    throw e;
  }
};

const writeProjectArchive = async (projects) => {
  if (!Array.isArray(projects)) {
    const err = new Error("Project archive payload must include a projects array.");
    err.status = 400;
    throw err;
  }
  await ensureParentDir(PROJECT_ARCHIVE_PATH);
  const payload = {
    version: 1,
    updated_at: new Date().toISOString(),
    projects
  };
  const tmpPath = `${PROJECT_ARCHIVE_PATH}.tmp`;
  await fs.writeFile(tmpPath, JSON.stringify(payload, null, 2), "utf8");
  await fs.rename(tmpPath, PROJECT_ARCHIVE_PATH);
};

const normalizeReferenceKind = (kind) => {
  const requested = String(kind || "").trim();
  return [
    "character_identity",
    "style_reference",
    "style_consistency",
    "product_reference"
  ].includes(requested)
    ? requested
    : "generic_reference";
};

const normalizeReferenceItems = (referenceImages) => {
  if (!Array.isArray(referenceImages)) return [];
  return referenceImages
    .map((item) => {
      if (typeof item === "string") {
        const imageUrl = item.trim();
        return imageUrl ? { kind: "generic_reference", label: "", imageUrl } : null;
      }

      const imageUrl = String(item?.image_url || item?.imageUrl || item?.url || item?.dataUrl || "").trim();
      if (!imageUrl) return null;
      return {
        kind: normalizeReferenceKind(item?.kind || item?.role || item?.type),
        label: sanitizeErrorMessage(item?.label || ""),
        imageUrl
      };
    })
    .filter(Boolean)
    .slice(0, 5);
};

const describeReferenceItem = (item, index) => {
  const prefix = `Reference image ${index + 1}${item.label ? ` (${item.label})` : ""}:`;
  if (item.kind === "character_identity") {
    return `${prefix} direct character reference. Keep the character recognizable and render them in the selected style from the prompt.`;
  }
  if (item.kind === "style_reference") {
    return `${prefix} style reference. Use linework, palette, shading, texture, and finish.`;
  }
  if (item.kind === "style_consistency") {
    return `${prefix} style continuity reference. Match rendering pipeline and finish level.`;
  }
  if (item.kind === "product_reference") {
    return `${prefix} product reference. Preserve product shape, color, material, and key details.`;
  }
  return `${prefix} visual reference for the prompt.`;
};

const isCodexSafetyRefusal = (error) => {
  const message = String(error?.message || "").toLowerCase();
  const code = String(error?.code || "").toLowerCase();
  return (
    message.includes("safety") ||
    message.includes("safety_violations") ||
    message.includes("sexual") ||
    message.includes("moderation") ||
    message.includes("rejected") ||
    message.includes("refused") ||
    code.includes("safety") ||
    code.includes("moderation")
  );
};

const buildCodexSafetyFallbackPrompt = (prompt) => `${prompt}

[SAFER VISUAL FALLBACK - IMPORTANT]
Regenerate the same comic/page with a clearer age-appropriate visual context: sports, leisure, fashion editorial, apparel catalog, or instruction.
- Preserve the educational meaning, layout, characters, and speech-bubble text exactly whenever possible. Change the visual staging, not the safe educational wording.
- Treat speech-bubble text and product/category labels as typography to render.
- If the topic is swimwear, keep it clearly about adult swimwear, swimming/sportswear, beachwear, fashion editorial, or apparel comparison. The presenter/model, if any, is clearly an adult.
- For swimwear type comparisons, product boards, hangers, mannequins, flat product diagrams, or worn examples are all valid when the adult/apparel context is clear.
- If any character is a child, student, teen, or minor, keep them in ordinary public clothing and use abstract charts/icons instead of modeling body-focused clothing or anatomy.
- Use full-body or waist-up composition with normal fashion, sports, leisure, store, pool, beach, or classroom staging.
- Choose the safer visual metaphor whenever wording could be ambiguous.`;

const extractSseData = (block) => {
  let eventData = "";
  for (const line of block.split("\n")) {
    if (line.startsWith("data: ")) eventData += line.slice(6);
  }
  return eventData;
};

const normalizeCodexImageModel = (model) => {
  const requested = String(model || "").trim();
  if (!requested) return CODEX_DEFAULT_IMAGE_MODEL;
  return CODEX_VALID_IMAGE_MODELS.has(requested) ? requested : CODEX_DEFAULT_IMAGE_MODEL;
};

const normalizeReasoningEffort = (value) => {
  const requested = String(value || "").trim().toLowerCase();
  return ["low", "medium", "high"].includes(requested) ? requested : "medium";
};

const validateCodexImageSize = (size) => {
  const match = /^(\d+)x(\d+)$/.exec(size);
  if (!match) return "Expected WIDTHxHEIGHT.";
  const width = Number.parseInt(match[1], 10);
  const height = Number.parseInt(match[2], 10);
  const longEdge = Math.max(width, height);
  const shortEdge = Math.min(width, height);
  const pixels = width * height;

  if (width % GPT_IMAGE_DIMENSION_STEP !== 0 || height % GPT_IMAGE_DIMENSION_STEP !== 0) {
    return "Both edges must be multiples of 16px.";
  }
  if (longEdge > GPT_IMAGE_MAX_EDGE) {
    return "Maximum edge length is 3840px.";
  }
  if (longEdge / shortEdge > GPT_IMAGE_MAX_LONG_TO_SHORT_RATIO) {
    return "Long edge to short edge ratio must not exceed 3:1.";
  }
  if (pixels < GPT_IMAGE_MIN_PIXELS || pixels > GPT_IMAGE_MAX_PIXELS) {
    return "Total pixels must be between 655360 and 8294400.";
  }
  return null;
};

let codexOAuthChild = null;
let codexOAuthShuttingDown = false;

const startCodexOAuthProxy = () => {
  if (!CODEX_OAUTH_AUTOSTART || codexOAuthChild) return;

  console.log(`[codex-oauth] starting openai-oauth on port ${CODEX_OAUTH_PROXY_PORT}...`);
  codexOAuthChild = spawn("npx", ["openai-oauth", "--port", String(CODEX_OAUTH_PROXY_PORT)], {
    stdio: ["ignore", "pipe", "pipe"],
    env: { ...process.env }
  });

  codexOAuthChild.stdout.on("data", (chunk) => {
    const message = chunk.toString().trim();
    if (message) console.log(`[codex-oauth] ${message}`);
  });
  codexOAuthChild.stderr.on("data", (chunk) => {
    const message = chunk.toString().trim();
    if (message && !message.includes("npm warn")) console.error(`[codex-oauth] ${message}`);
  });
  codexOAuthChild.on("exit", (code) => {
    codexOAuthChild = null;
    if (codexOAuthShuttingDown || !CODEX_OAUTH_AUTOSTART) return;
    console.warn(`[codex-oauth] exited with code ${code}; restarting in 5s...`);
    setTimeout(startCodexOAuthProxy, 5000);
  });
};

const stopCodexOAuthProxy = () => {
  codexOAuthShuttingDown = true;
  try {
    codexOAuthChild?.kill();
  } catch {
    // Best effort during server shutdown.
  }
};

process.once("SIGINT", () => {
  stopCodexOAuthProxy();
  process.exit(0);
});
process.once("SIGTERM", () => {
  stopCodexOAuthProxy();
  process.exit(0);
});

const getCodexOAuthStatus = async () => {
  try {
    const response = await fetch(`${CODEX_OAUTH_URL}/v1/models`, {
      signal: AbortSignal.timeout(3000)
    });
    if (!response.ok) return { status: "auth_required", models: [] };
    const data = await response.json();
    const models = Array.isArray(data?.data) ? data.data.map((m) => m?.id).filter(Boolean) : [];
    return { status: "ready", models };
  } catch {
    return { status: CODEX_OAUTH_AUTOSTART ? "starting" : "offline", models: [] };
  }
};

const CODEX_IMAGE_DEVELOPER_PROMPT = [
  "You are an image generation assistant for a local comic production app.",
  "Your sole function is to invoke the image_generation tool and return an image.",
  "Follow the user's comic page prompt closely. Preserve Korean text exactly when requested.",
  "Do not add logos, watermarks, signatures, or UI elements.",
  "Prioritize clean linework, readable speech bubbles, consistent character identity, and stable multi-panel composition.",
  "Respect per-image reference role labels. Character references are identity-only unless the user prompt says otherwise; style must come from the prompt's STYLE instructions.",
  "You may use web_search only to ground current real-world details when helpful, but you must always finish by invoking the image_generation tool.",
  "Just do it."
].join(" ");

const CODEX_PROMPT_FIDELITY_SUFFIX =
  "\n\nWhen you call the image_generation tool, use the user's prompt as the primary image prompt. Do not translate, summarize, restyle, or inject extra story details. If the prompt contains Korean text, keep it in Korean.";

const readCodexImageStream = async (response) => {
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let imageB64 = null;
  let revisedPrompt = null;
  let usage = null;

  const handleBlock = (block) => {
    const eventData = extractSseData(block);
    if (!eventData || eventData === "[DONE]") return;

    const data = parseJsonSafe(eventData);
    if (!data) return;
    if (data.type === "response.output_item.done" && data.item?.type === "image_generation_call") {
      if (typeof data.item.result === "string" && data.item.result) imageB64 = data.item.result;
      if (typeof data.item.revised_prompt === "string" && data.item.revised_prompt) {
        revisedPrompt = data.item.revised_prompt;
      }
    }
    if (data.type === "response.completed") usage = data.response?.usage || null;
    if (data.type === "error") {
      const err = new Error(sanitizeErrorMessage(data.error?.message) || "Codex OAuth stream returned an error.");
      err.code = data.error?.code || "CODEX_OAUTH_STREAM_ERROR";
      throw err;
    }
  };

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    let boundary;
    while ((boundary = buffer.indexOf("\n\n")) !== -1) {
      const block = buffer.slice(0, boundary);
      buffer = buffer.slice(boundary + 2);
      handleBlock(block);
    }
  }

  if (buffer.trim()) handleBlock(buffer);
  return { imageB64, revisedPrompt, usage };
};

const readCodexImageJson = (json) => {
  let imageB64 = null;
  let revisedPrompt = null;

  for (const item of json?.output || []) {
    if (item?.type !== "image_generation_call") continue;
    if (typeof item.result === "string" && item.result) imageB64 = item.result;
    if (typeof item.revised_prompt === "string" && item.revised_prompt) {
      revisedPrompt = item.revised_prompt;
    }
    if (imageB64) break;
  }

  return { imageB64, revisedPrompt, usage: json?.usage || null };
};

const throwCodexImageHttpError = async (response) => {
  const rawText = await response.text();
  const err = new Error(
    sanitizeErrorMessage(parseJsonSafe(rawText)?.error?.message || rawText) ||
      `Codex OAuth image request failed (${response.status}).`
  );
  err.status = response.status;
  throw err;
};

const generateCodexImage = async ({ prompt, size, quality, moderation, model, referenceImages }) => {
  const resolvedModel = normalizeCodexImageModel(model);
  const validReferenceItems = normalizeReferenceItems(referenceImages);
  const userContent = validReferenceItems.length > 0
    ? [
        {
          type: "input_text",
          text: "Use the attached images as visual references for the prompt."
        },
        ...validReferenceItems.flatMap((item, index) => [
          { type: "input_text", text: describeReferenceItem(item, index) },
          { type: "input_image", image_url: item.imageUrl }
        ]),
        { type: "input_text", text: `${prompt}${CODEX_PROMPT_FIDELITY_SUFFIX}` }
      ]
    : `${prompt}${CODEX_PROMPT_FIDELITY_SUFFIX}`;
  const buildRequestBody = (stream) => ({
    model: resolvedModel,
    input: [
      { role: "developer", content: CODEX_IMAGE_DEVELOPER_PROMPT },
      { role: "user", content: userContent }
    ],
    tools: [
      { type: "web_search" },
      {
        type: "image_generation",
        quality,
        size,
        moderation
      }
    ],
    tool_choice: "required",
    stream
  });

  const response = await fetch(`${CODEX_OAUTH_URL}/v1/responses`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "text/event-stream" },
    body: JSON.stringify(buildRequestBody(true))
  });

  if (!response.ok) await throwCodexImageHttpError(response);

  const contentType = response.headers.get("content-type") || "";
  let { imageB64, revisedPrompt, usage } = contentType.includes("text/event-stream")
    ? await readCodexImageStream(response)
    : readCodexImageJson(await response.json());

  if (!imageB64) {
    console.warn("[codex-oauth] image stream contained no image; retrying as JSON", {
      model: resolvedModel,
      size,
      quality
    });
    const retryResponse = await fetch(`${CODEX_OAUTH_URL}/v1/responses`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(buildRequestBody(false))
    });

    if (!retryResponse.ok) await throwCodexImageHttpError(retryResponse);

    ({ imageB64, revisedPrompt, usage } = readCodexImageJson(await retryResponse.json()));
  }
  if (!imageB64) throw new Error("Codex OAuth response did not include image data.");
  return {
    image_data_url: "data:image/png;base64," + imageB64,
    revised_prompt: revisedPrompt,
    usage,
    model: resolvedModel
  };
};

const extractCodexText = (json) => {
  if (typeof json?.output_text === "string") return json.output_text;
  for (const item of json?.output || []) {
    for (const content of item?.content || []) {
      if (typeof content?.text === "string") return content.text;
      if (typeof content?.value === "string") return content.value;
    }
  }
  return "";
};

const readCodexTextStream = async (response) => {
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let text = "";
  let usage = null;

  const handleBlock = (block) => {
    const eventData = extractSseData(block);
    if (!eventData || eventData === "[DONE]") return;

    const data = parseJsonSafe(eventData);
    if (!data) return;

    if (data.type === "response.output_text.delta" && typeof data.delta === "string") {
      text += data.delta;
    }
    if (data.type === "response.output_text.done" && typeof data.text === "string") {
      text = data.text;
    }
    if (data.type === "response.output_item.done" && data.item?.type === "message" && !text.trim()) {
      const itemText = extractCodexText({ output: [data.item] });
      if (itemText) text = itemText;
    }
    if (data.type === "response.completed") usage = data.response?.usage || null;
    if (data.type === "error") {
      const err = new Error(sanitizeErrorMessage(data.error?.message) || "Codex OAuth stream returned an error.");
      err.code = data.error?.code || "CODEX_OAUTH_STREAM_ERROR";
      throw err;
    }
  };

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    let boundary;
    while ((boundary = buffer.indexOf("\n\n")) !== -1) {
      const block = buffer.slice(0, boundary);
      buffer = buffer.slice(boundary + 2);
      handleBlock(block);
    }
  }

  if (buffer.trim()) handleBlock(buffer);
  return { text: text.trim(), usage };
};

const normalizeSchemaType = (value) => {
  if (typeof value !== "string") return undefined;
  const normalized = value.toLowerCase();
  if (["object", "array", "string", "number", "integer", "boolean", "null"].includes(normalized)) return normalized;
  return undefined;
};

const convertSchemaToJsonSchema = (schema) => {
  if (!schema || typeof schema !== "object") return {};

  const type = normalizeSchemaType(schema.type);
  const next = {};
  if (schema.description) next.description = schema.description;
  if (Array.isArray(schema.enum)) next.enum = [...schema.enum];

  if (type === "object") {
    next.type = "object";
    const properties = schema.properties || {};
    next.properties = Object.fromEntries(
      Object.entries(properties).map(([key, value]) => [key, convertSchemaToJsonSchema(value)])
    );
    next.required = Array.isArray(schema.required) ? schema.required : Object.keys(next.properties);
    next.additionalProperties = false;
  } else if (type === "array") {
    next.type = "array";
    next.items = convertSchemaToJsonSchema(schema.items || {});
  } else if (type) {
    next.type = type;
  }

  return next;
};

const getRequestParts = (request) => {
  const contents = request?.contents;
  if (Array.isArray(contents?.parts)) return contents.parts;
  if (Array.isArray(contents)) {
    return contents.flatMap((entry) => (Array.isArray(entry?.parts) ? entry.parts : []));
  }
  return [];
};

const buildCodexUserContent = (request) => {
  const parts = getRequestParts(request);
  const content = [];
  for (const part of parts) {
    if (typeof part?.text === "string" && part.text.trim()) {
      content.push({ type: "input_text", text: part.text });
    }
    const inlineData = part?.inlineData || part?.inline_data;
    const mimeType = inlineData?.mimeType || inlineData?.mime_type || "image/png";
    const data = inlineData?.data;
    if (typeof data === "string" && data.trim() && String(mimeType).startsWith("image/")) {
      content.push({ type: "input_image", image_url: `data:${mimeType};base64,${data}` });
    } else if (typeof data === "string" && data.trim()) {
      content.push({
        type: "input_file",
        filename: inlineData?.name || `input.${String(mimeType).includes("pdf") ? "pdf" : "bin"}`,
        file_data: `data:${mimeType};base64,${data}`
      });
    }
  }
  if (content.length === 1 && content[0].type === "input_text") return content[0].text;
  return content;
};

const generateCodexContent = async (request) => {
  const systemInstruction = String(request?.config?.systemInstruction || "").trim();
  const schema = request?.config?.responseJsonSchema || (
    request?.config?.responseSchema ? convertSchemaToJsonSchema(request.config.responseSchema) : null
  );
  const wantsPlainText = String(request?.config?.responseMimeType || "").trim().toLowerCase() === "text/plain";
  const enableSearch = Array.isArray(request?.config?.tools) && request.config.tools.some((tool) => tool?.googleSearch);
  const model = normalizeCodexImageModel(request?.model || CODEX_DEFAULT_TEXT_MODEL);
  const reasoningEffort = normalizeReasoningEffort(
    request?.config?.reasoningEffort ||
      request?.config?.reasoning_effort ||
      request?.config?.thinkingConfig?.reasoningEffort
  );
  const userContent = buildCodexUserContent(request);
  const body = {
    model,
    input: [
      systemInstruction ? { role: "developer", content: systemInstruction } : null,
      { role: "user", content: userContent }
    ].filter(Boolean),
    stream: true,
    ...(wantsPlainText
      ? {}
      : schema
      ? {
          text: {
            format: {
              type: "json_schema",
              name: "toon_for_codex_output",
              strict: true,
              schema
            }
          }
        }
      : { text: { format: { type: "json_object" } } }),
    reasoning: { effort: reasoningEffort },
    ...(enableSearch ? { tools: [{ type: "web_search" }] } : {})
  };

  let response = await fetch(`${CODEX_OAUTH_URL}/v1/responses`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "text/event-stream" },
    body: JSON.stringify(body)
  });

  if (!response.ok && schema) {
    response = await fetch(`${CODEX_OAUTH_URL}/v1/responses`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "text/event-stream" },
      body: JSON.stringify({
        ...body,
        text: { format: { type: "json_object" } }
      })
    });
  }

  if (!response.ok) {
    const rawText = await response.text();
    const err = new Error(
      sanitizeErrorMessage(parseJsonSafe(rawText)?.error?.message || rawText) ||
        `Codex OAuth text request failed (${response.status}).`
    );
    err.status = response.status;
    throw err;
  }

  const streamResult = await readCodexTextStream(response);
  const text = streamResult.text;
  if (!text) throw new Error("Codex OAuth response did not include text.");
  return {
    text,
    candidates: [{ content: { parts: [{ text }] } }],
    raw_response: null,
    usage: streamResult.usage
  };
};

const app = express();
app.disable("x-powered-by");
app.use(express.json({ limit: JSON_LIMIT }));

app.get("/api/health", (_req, res) => {
  res.json({
    codex_oauth_autostart: CODEX_OAUTH_AUTOSTART,
    codex_oauth_port: CODEX_OAUTH_PROXY_PORT,
    codex_image_model: CODEX_DEFAULT_IMAGE_MODEL,
    codex_text_model: CODEX_DEFAULT_TEXT_MODEL
  });
});

app.get("/api/oauth/status", async (_req, res) => {
  res.json(await getCodexOAuthStatus());
});

app.get("/api/project-archive", async (_req, res) => {
  try {
    res.json({
      storage_path: PROJECT_ARCHIVE_PATH,
      projects: await readProjectArchive()
    });
  } catch (e) {
    const message = sanitizeErrorMessage(e?.message) || "Failed to read local project archive.";
    console.error("[api] project archive read failed", { message, storage_path: PROJECT_ARCHIVE_PATH });
    res.status(500).json({ error: { message } });
  }
});

app.post("/api/project-archive", async (req, res) => {
  try {
    await writeProjectArchive(req.body?.projects);
    res.json({
      ok: true,
      storage_path: PROJECT_ARCHIVE_PATH,
      count: req.body.projects.length
    });
  } catch (e) {
    const message = sanitizeErrorMessage(e?.message) || "Failed to write local project archive.";
    console.error("[api] project archive write failed", { status: e?.status || 500, message, storage_path: PROJECT_ARCHIVE_PATH });
    res.status(e?.status || 500).json({ error: { message } });
  }
});

app.post("/api/codex/generate-image", async (req, res) => {
  const prompt = String(req.body?.prompt || "").trim();
  const size = String(req.body?.size || "").trim();
  const quality = String(req.body?.quality || "medium").trim().toLowerCase();
  const moderation = String(req.body?.moderation || CODEX_DEFAULT_MODERATION).trim().toLowerCase();
  const model = String(req.body?.model || CODEX_DEFAULT_IMAGE_MODEL).trim() || CODEX_DEFAULT_IMAGE_MODEL;
  const referenceImages = Array.isArray(req.body?.reference_images) ? req.body.reference_images : [];

  if (!prompt) {
    res.status(400).json({ error: { message: "Missing prompt." } });
    return;
  }
  const sizeError = validateCodexImageSize(size);
  if (sizeError) {
    res.status(400).json({ error: { message: `Invalid Codex image size. ${sizeError}` } });
    return;
  }
  if (!["low", "medium", "high"].includes(quality)) {
    res.status(400).json({ error: { message: "Invalid Codex image quality. Use low, medium, or high." } });
    return;
  }
  if (!["auto", "low"].includes(moderation)) {
    res.status(400).json({ error: { message: "Invalid Codex image moderation. Use auto or low." } });
    return;
  }

  try {
    let image;
    try {
      image = await generateCodexImage({
        prompt,
        size,
        quality,
        moderation,
        model,
        referenceImages
      });
    } catch (firstError) {
      if (!isCodexSafetyRefusal(firstError)) throw firstError;

      console.warn("[api] codex generate-image safety fallback retry", {
        status: firstError?.status || 422,
        model: normalizeCodexImageModel(model),
        message: sanitizeErrorMessage(firstError?.message)
      });

      image = await generateCodexImage({
        prompt: buildCodexSafetyFallbackPrompt(prompt),
        size,
        quality,
        moderation: "low",
        model,
        referenceImages
      });
      image.safety_retry = true;
    }
    res.json(image);
  } catch (e) {
    const message = sanitizeErrorMessage(e?.message) || "Codex OAuth image request failed.";
    console.error("[api] codex generate-image failed", {
      status: e?.status || 502,
      model: normalizeCodexImageModel(model),
      message
    });
    res.status(e?.status || 502).json({ error: { message } });
  }
});

app.post("/api/codex/generate-content", async (req, res) => {
  const request = req.body?.request ?? req.body;
  if (!request || typeof request !== "object" || Array.isArray(request)) {
    res.status(400).json({ error: { message: "Missing request payload." } });
    return;
  }
  if (!request.contents) {
    res.status(400).json({ error: { message: "Invalid request payload: `contents` is required." } });
    return;
  }

  try {
    res.json(await generateCodexContent(request));
  } catch (e) {
    const message = sanitizeErrorMessage(e?.message) || "Codex OAuth text request failed.";
    console.error("[api] codex generate-content failed", {
      status: e?.status || 502,
      model: normalizeCodexImageModel(request?.model || CODEX_DEFAULT_TEXT_MODEL),
      message
    });
    res.status(e?.status || 502).json({ error: { message } });
  }
});

startCodexOAuthProxy();

app.listen(PORT, () => {
  console.log(`[local-api] listening on http://127.0.0.1:${PORT}`);
  console.log(`[local-api] Codex OAuth: ${CODEX_OAUTH_AUTOSTART ? "auto" : "manual"} on ${CODEX_OAUTH_URL}`);
});
