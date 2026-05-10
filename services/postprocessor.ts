
import { PageSpec, SeriesSpec } from "../types";
import { parseDataUrl } from "./dataUrl";
import { zipSync } from "fflate";

/**
 * In this version, we trust the image model to render Korean text directly.
 * The postprocessor now primarily handles the final image delivery.
 */
export const overlayTextOnImage = async (
  imageUrl: string, 
  pageSpec: PageSpec, 
  seriesSpec: SeriesSpec
): Promise<string> => {
  // If the user's strategy is 'embed_in_image', we just return the raw image.
  // We keep the structure for potential future enhancements (like watermarks or subtle branding).
  return imageUrl;
};

const sanitizeFilename = (name: string): string =>
  name
    .trim()
    .replace(/[\\/:*?"<>|]+/g, "_")
    .replace(/\s+/g, " ")
    .slice(0, 180) || "Jadonghwa Comic Studio";

const extFromMime = (mimeType: string | null | undefined): string | null => {
  if (!mimeType) return null;
  const normalized = mimeType.toLowerCase().split(";")[0].trim();
  if (normalized === "image/jpeg") return "jpg";
  if (normalized === "image/jpg") return "jpg";
  if (normalized === "image/png") return "png";
  if (normalized === "image/webp") return "webp";
  return null;
};

const extFromUrl = (url: string): string => {
  try {
    const u = new URL(url);
    const match = u.pathname.match(/\.([a-z0-9]{2,5})$/i);
    if (!match) return "png";
    const ext = match[1].toLowerCase();
    if (["png", "jpg", "jpeg", "webp"].includes(ext)) return ext === "jpeg" ? "jpg" : ext;
    return "png";
  } catch {
    return "png";
  }
};

const base64ToBytes = (base64: string): Uint8Array => {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
};

const textToBytes = (value: string): Uint8Array => new TextEncoder().encode(value);

const urlToBytesAndExt = async (url: string): Promise<{ bytes: Uint8Array; ext: string }> => {
  if (url.startsWith("data:")) {
    const parsed = parseDataUrl(url);
    if (!parsed) throw new Error("Invalid data URL");
    return { bytes: base64ToBytes(parsed.base64), ext: extFromMime(parsed.mimeType) || "png" };
  }

  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to fetch image: ${res.status} ${res.statusText}`);
  const mimeType = res.headers.get("content-type");
  const buffer = await res.arrayBuffer();
  return { bytes: new Uint8Array(buffer), ext: extFromMime(mimeType) || extFromUrl(url) };
};

export const downloadAsZip = async (
  images: { name: string; url: string }[],
  zipName?: string
) => {
  if (images.length === 0) throw new Error("No images to download");

  const files: Record<string, Uint8Array> = {};
  for (const img of images) {
    const { bytes, ext } = await urlToBytesAndExt(img.url);
    const base = sanitizeFilename(img.name);
    const filename = `${base}.${ext}`;

    if (!files[filename]) files[filename] = bytes;
    else {
      let n = 2;
      while (files[`${base}_${n}.${ext}`]) n++;
      files[`${base}_${n}.${ext}`] = bytes;
    }
  }

  const zipped = zipSync(files, { level: 6 });
  const blob = new Blob([zipped], { type: "application/zip" });
  const link = document.createElement("a");
  const url = URL.createObjectURL(blob);
  link.href = url;
  link.download = `${sanitizeFilename(zipName || "Jadonghwa Comic Studio")}.zip`;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
};

export const downloadFilesAsZip = (
  files: Record<string, string | Uint8Array>,
  zipName?: string
) => {
  const entries: Record<string, Uint8Array> = {};
  for (const [path, content] of Object.entries(files)) {
    const normalizedPath = path
      .split("/")
      .map((part) => sanitizeFilename(part))
      .filter(Boolean)
      .join("/");
    if (!normalizedPath) continue;
    entries[normalizedPath] = typeof content === "string" ? textToBytes(content) : content;
  }

  if (Object.keys(entries).length === 0) throw new Error("No files to download");

  const zipped = zipSync(entries, { level: 6 });
  const blob = new Blob([zipped], { type: "application/zip" });
  const link = document.createElement("a");
  const url = URL.createObjectURL(blob);
  link.href = url;
  link.download = `${sanitizeFilename(zipName || "Jadonghwa Comic Studio_files")}.zip`;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
};
