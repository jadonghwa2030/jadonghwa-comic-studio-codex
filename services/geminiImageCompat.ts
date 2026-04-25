import { ImageSize } from "../types";

/**
 * Pass through the requested image size directly.
 * Gemini imagen now supports 1K, 2K, and 4K.
 */
export const normalizeGeminiImageSize = (imageSize: ImageSize, _context: string): ImageSize => {
  return imageSize;
};
