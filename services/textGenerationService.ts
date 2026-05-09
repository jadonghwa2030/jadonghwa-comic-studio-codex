import { postJson } from "./localApi";

const getGeminiTextModel = (): string => {
  const preferred = (import.meta as any).env?.VITE_GEMINI_TEXT_MODEL as unknown;
  if (typeof preferred === "string" && preferred.trim()) return preferred.trim();
  const plannerModel = (import.meta as any).env?.VITE_GEMINI_PLANNER_MODEL as unknown;
  if (typeof plannerModel === "string" && plannerModel.trim()) return plannerModel.trim();
  return "gemini-3-pro-preview";
};

const resolveGeminiTextModel = (model: unknown): string => {
  const requested = typeof model === "string" ? model.trim() : "";
  return requested.startsWith("gemini-") ? requested : getGeminiTextModel();
};

export const withGeminiTextModel = (request: any): any => ({
  ...request,
  model: resolveGeminiTextModel(request?.model)
});

export const generateGeminiContent = async <T = any>(request: any): Promise<T> => {
  return await postJson<T>("/api/gemini/generate-content", {
    request: withGeminiTextModel(request)
  });
};
