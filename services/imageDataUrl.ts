const loadImageFromDataUrl = (dataUrl: string): Promise<HTMLImageElement> =>
  new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("Failed to load image."));
    image.src = dataUrl;
  });

const readFileAsDataUrlRaw = (file: File): Promise<string> =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("Failed to read image."));
    reader.onload = () => resolve(String(reader.result || ""));
    reader.readAsDataURL(file);
  });

export const compressImageDataUrl = async (
  dataUrl: string,
  options: { maxEdge: number; maxLength: number; quality: number }
): Promise<string> => {
  if (!/^data:image\//i.test(dataUrl)) return dataUrl;
  if (/^data:image\/(gif|svg\+xml)/i.test(dataUrl)) return dataUrl;
  if (dataUrl.length <= options.maxLength) return dataUrl;

  try {
    const image = await loadImageFromDataUrl(dataUrl);
    const sourceW = image.naturalWidth || image.width;
    const sourceH = image.naturalHeight || image.height;
    if (!sourceW || !sourceH) return dataUrl;

    const renderJpeg = (w: number, h: number, quality: number): string | null => {
      const canvas = document.createElement("canvas");
      canvas.width = w;
      canvas.height = h;
      const context = canvas.getContext("2d");
      if (!context) return null;
      context.fillStyle = "#ffffff";
      context.fillRect(0, 0, w, h);
      context.drawImage(image, 0, 0, w, h);
      return canvas.toDataURL("image/jpeg", quality);
    };

    const initialScale = Math.min(1, options.maxEdge / Math.max(sourceW, sourceH));
    let targetW = Math.max(1, Math.round(sourceW * initialScale));
    let targetH = Math.max(1, Math.round(sourceH * initialScale));
    let quality = options.quality;
    let best = dataUrl;

    for (let pass = 0; pass < 6; pass += 1) {
      const compressed = renderJpeg(targetW, targetH, quality);
      if (!compressed) break;
      if (compressed.length < best.length) best = compressed;
      if (compressed.length <= options.maxLength) return compressed;

      quality = Math.max(0.5, quality - 0.12);
      targetW = Math.max(1, Math.round(targetW * 0.8));
      targetH = Math.max(1, Math.round(targetH * 0.8));
    }

    return best.length < dataUrl.length ? best : dataUrl;
  } catch {
    return dataUrl;
  }
};

export const readImageFileAsCompressedDataUrl = async (
  file: File,
  options: { maxEdge: number; maxLength: number; quality: number }
): Promise<string> => {
  const raw = await readFileAsDataUrlRaw(file);
  return compressImageDataUrl(raw, options);
};
