import type { GroundingSource, ResearchPack } from "../types";
import { generateGeminiContent } from "./textGenerationService";

const getGeminiResearchModel = (): string => {
  const geminiPreferred = (import.meta as any).env?.VITE_GEMINI_RESEARCH_MODEL as unknown;
  if (typeof geminiPreferred === "string" && geminiPreferred.trim()) return geminiPreferred.trim();
  const codexPreferred = (import.meta as any).env?.VITE_CODEX_RESEARCH_MODEL as unknown;
  if (typeof codexPreferred === "string" && codexPreferred.trim().startsWith("gemini-")) return codexPreferred.trim();
  const geminiPlanner = (import.meta as any).env?.VITE_GEMINI_PLANNER_MODEL as unknown;
  if (typeof geminiPlanner === "string" && geminiPlanner.trim()) return geminiPlanner.trim();
  const codexPlanner = (import.meta as any).env?.VITE_CODEX_PLANNER_MODEL as unknown;
  if (typeof codexPlanner === "string" && codexPlanner.trim().startsWith("gemini-")) return codexPlanner.trim();
  return "gemini-3-pro-preview";
};

const getGeminiResearchMaxOutputTokens = (): number => {
  const preferred = (import.meta as any).env?.VITE_CODEX_RESEARCH_MAX_OUTPUT_TOKENS as unknown;
  if (typeof preferred === "string" && preferred.trim()) {
    const parsed = Number(preferred);
    if (Number.isFinite(parsed) && parsed > 0) return Math.floor(parsed);
  }
  return 8000;
};

const safeParseJson = (text: string): any => {
  const trimmed = text.trim();
  if (!trimmed) throw new Error("Codex returned an empty response.");
  try {
    return JSON.parse(trimmed);
  } catch {
    const match = trimmed.match(/\{[\s\S]*\}/);
    if (!match) throw new Error("Codex returned invalid JSON.");
    return JSON.parse(match[0]);
  }
};

const coerceSources = (value: unknown): GroundingSource[] => {
  if (!Array.isArray(value)) return [];
  const dedup = new Map<string, GroundingSource>();

  for (const item of value) {
    if (!item || typeof item !== "object") continue;
    const anyItem = item as any;
    const uri = String(anyItem.uri ?? anyItem.url ?? anyItem.link ?? "").trim();
    if (!uri) continue;
    const title = String(anyItem.title ?? anyItem.name ?? "참고 자료").trim() || "참고 자료";
    if (!dedup.has(uri)) dedup.set(uri, { title, uri });
  }

  return Array.from(dedup.values());
};

const extractGeminiSources = (json: any): GroundingSource[] => {
  const chunks = json?.candidates?.[0]?.groundingMetadata?.groundingChunks;
  if (!Array.isArray(chunks)) return [];
  return coerceSources(chunks.map((chunk: any) => chunk?.web).filter(Boolean));
};

const geminiGenerateContent = async (request: any): Promise<any> => {
  return await generateGeminiContent<any>(request);
};

export const generateGeminiResearchPack = async (params: {
  topic: string;
  reasoning_effort?: "low" | "medium" | "high";
}): Promise<ResearchPack> => {
  const model = getGeminiResearchModel();
  const reasoningEffort = params.reasoning_effort || "medium";
  const maxOutputTokens = getGeminiResearchMaxOutputTokens();
  const userPrompt = `"${params.topic}"에 대해 소설형식으로 쉽게 설명해줘.
`;

  const baseConfig = {
    responseMimeType: "text/plain",
    tools: [{ googleSearch: {} }],
    maxOutputTokens,
    reasoningEffort
  };

  let lastError: any = null;
  let json: any = null;

  try {
    json = await geminiGenerateContent({
      model,
      contents: { parts: [{ text: userPrompt }] },
      config: baseConfig
    });
  } catch (e: any) {
    lastError = e;
  }

  if (!json) throw lastError || new Error("Codex request failed.");

  const outputText = String(json?.text || "").trim();
  const notes = outputText;

  if (!notes) throw new Error("Codex returned empty notes.");

  return {
    notes,
    sources: []
  };
};
