export type InlineDataLike = {
  mimeType?: string;
  data?: string;
};

export const inlineDataToDataUrl = (inlineData: InlineDataLike | null | undefined): string | null => {
  const data = inlineData?.data;
  if (!data) return null;
  const mimeType = inlineData?.mimeType || "image/png";
  return `data:${mimeType};base64,${data}`;
};

export const parseDataUrl = (dataUrl: string): { mimeType: string; base64: string } | null => {
  const match = dataUrl.match(/^data:([^;]+);base64,(.+)$/);
  if (!match) return null;
  return { mimeType: match[1], base64: match[2] };
};
