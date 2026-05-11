import { generateGeminiContent } from "./textGenerationService";

export interface ResearchDigestResult {
  notes: string;
  warnings?: string[];
}

const fileToBase64 = (file: File): Promise<{ name: string; mimeType: string; base64: string }> => {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("Failed to read file."));
    reader.onload = () => {
      const result = typeof reader.result === "string" ? reader.result : "";
      const match = result.match(/^data:([^;]+);base64,(.+)$/);
      if (!match) {
        reject(new Error("Failed to encode file as base64."));
        return;
      }
      resolve({
        name: file.name || `research_${Date.now()}`,
        mimeType: match[1] || file.type || "application/octet-stream",
        base64: match[2]
      });
    };
    reader.readAsDataURL(file);
  });
};

const isInvalidGeminiArgumentError = (error: unknown): boolean =>
  /invalid argument|invalid_argument|invalid json payload|unsupported|mime/i.test(String((error as any)?.message || error || ""));

const buildUnsupportedFileMessage = (file?: { name?: string; mimeType?: string }): string => {
  const fileLabel = file?.name ? ` (${file.name})` : "";
  const mimeLabel = file?.mimeType ? ` MIME: ${file.mimeType}` : "";
  return `Gemini가 업로드 파일${fileLabel}을 읽지 못했어.${mimeLabel} 파일이 손상됐거나 Gemini가 해당 PDF 구조를 해석하지 못했을 수 있어. 핵심 내용을 텍스트로 붙여넣어 다시 시도해줘.`;
};

const requestResearchDigest = async (params: {
  topic: string;
  report_text?: string;
  filePayload?: { name: string; mimeType: string; base64: string };
}): Promise<{ text: string }> => {
  return await generateGeminiContent<{ text: string }>({
    model: "gemini-3-pro-preview",
    contents: {
      parts: [
        params.filePayload
          ? { inlineData: { mimeType: params.filePayload.mimeType, data: params.filePayload.base64, name: params.filePayload.name } }
          : null,
        {
          text: `다음 사용자 리서치 자료를 읽고, "${params.topic}"에 대해 사용자가 자연스럽게 이해할 수 있는 해설 원고를 소설처럼 써줘.

자료:
${String(params.report_text || "").slice(0, 60000)}
`
        }
      ].filter(Boolean)
    },
    config: {
      responseMimeType: "text/plain"
    }
  });
};

export const analyzeResearchReport = async (params: {
  topic: string;
  report_text?: string;
  file?: File;
}): Promise<ResearchDigestResult> => {
  const filePayload = params.file ? await fileToBase64(params.file) : undefined;
  let response: { text: string };
  let usedTextFallback = false;
  try {
    response = await requestResearchDigest({
      topic: params.topic,
      report_text: params.report_text,
      filePayload
    });
  } catch (error) {
    const hasFallbackText = Boolean(String(params.report_text || "").trim());
    if (!filePayload || !isInvalidGeminiArgumentError(error) || !hasFallbackText) {
      if (filePayload && isInvalidGeminiArgumentError(error)) {
        throw new Error(buildUnsupportedFileMessage(filePayload));
      }
      throw error;
    }
    response = await requestResearchDigest({
      topic: params.topic,
      report_text: params.report_text
    });
    usedTextFallback = true;
  }
  return {
    notes: String(response.text || "").trim(),
    warnings: usedTextFallback
      ? ["Gemini가 업로드 파일을 직접 읽지 못해서, 함께 입력된 텍스트 자료만 사용했어."]
      : []
  };
};
