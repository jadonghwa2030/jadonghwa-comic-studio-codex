import { postJson } from "./localApi";

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

export const analyzeResearchReport = async (params: {
  topic: string;
  report_text?: string;
  file?: File;
}): Promise<ResearchDigestResult> => {
  const filePayload = params.file ? await fileToBase64(params.file) : undefined;
  const response = await postJson<{ text: string }>("/api/codex/generate-content", {
    request: {
      model: "gpt-5.5",
      contents: {
        parts: [
          filePayload
            ? { inlineData: { mimeType: filePayload.mimeType, data: filePayload.base64, name: filePayload.name } }
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
    }
  });
  return {
    notes: String(response.text || "").trim(),
    warnings: []
  };
};
