import {
  ComicMode,
  GenerationResult,
  ImageSize,
  CodexImageQuality,
  PageSpec,
  SeriesPlan,
  SeriesSpec
} from "../types";
import { parseDataUrl } from "./dataUrl";
import { buildFullPageImageRequest } from "./renderer";

interface BuildCodexHandoffFilesParams {
  seriesPlan: SeriesPlan;
  imageSize: ImageSize;
  comicMode: ComicMode;
  codexImageQuality: CodexImageQuality;
  codexImageModel: string;
  pageStyleOverrides: Record<number, SeriesSpec["anchors"]["style"]>;
  pageResults: GenerationResult[];
  useCrossPageStyleConsistency: boolean;
}

interface HandoffPageManifestEntry {
  page_index: number;
  chapter_title: string;
  prompt_file: string;
  output_file: string;
  reference_files: string[];
  model: string;
  size: string;
  quality: CodexImageQuality;
}

const bytesFromBase64 = (base64: string): Uint8Array => {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
};

const extensionFromMimeType = (mimeType: string): string => {
  const normalized = mimeType.toLowerCase().split(";")[0].trim();
  if (normalized === "image/jpeg" || normalized === "image/jpg") return "jpg";
  if (normalized === "image/webp") return "webp";
  return "png";
};

const padPageIndex = (index: number): string => String(index).padStart(3, "0");

const getStyleConsistencyImage = (
  page: PageSpec,
  pageResults: GenerationResult[],
  enabled: boolean,
  hasStyleOverride: boolean
): string | null => {
  if (!enabled || hasStyleOverride) return null;
  return (
    pageResults
      .filter((r) => r.page_index !== page.page.index && r.composed_image_url?.startsWith("data:"))
      .sort((a, b) => {
        const diffA = Math.abs(a.page_index - page.page.index);
        const diffB = Math.abs(b.page_index - page.page.index);
        if (diffA !== diffB) return diffA - diffB;
        return a.page_index - b.page_index;
      })[0]?.composed_image_url || null
  );
};

const buildPromptMarkdown = (entry: HandoffPageManifestEntry, prompt: string): string => `# Page ${padPageIndex(entry.page_index)} - ${entry.chapter_title}

Model: ${entry.model}
Size: ${entry.size}
Quality: ${entry.quality}
Output: ${entry.output_file}

## Reference Images

${entry.reference_files.length > 0 ? entry.reference_files.map((file) => `- ${file}`).join("\n") : "- None"}

## Generation Prompt

\`\`\`text
${prompt}
\`\`\`
`;

const buildInstructionsMarkdown = (manifest: {
  project_title: string;
  pages: HandoffPageManifestEntry[];
}): string => `# Toon for Codex Handoff

이 ZIP은 Toon for Codex가 만든 GPT Image 2용 제작 묶음이야.

## 작업 순서

1. \`manifest.json\`을 먼저 확인한다.
2. \`prompts/page-001.md\`부터 순서대로 읽는다.
3. 각 프롬프트의 \`Reference Images\`에 적힌 파일을 함께 참고한다.
4. Codex 앱의 이미지 생성 기능으로 GPT Image 2 이미지를 만든다.
5. 결과 파일은 \`outputs/page-001.png\`, \`outputs/page-002.png\` 형식으로 저장한다.
6. 모든 결과를 만든 뒤 Toon for Codex에서 다시 가져온다.

## 프로젝트

- Title: ${manifest.project_title}
- Pages: ${manifest.pages.length}
- Output folder: \`outputs/\`

## 주의

- 프롬프트 안의 말풍선/텍스트 규칙을 그대로 따른다.
- 프롬프트에 없는 로고, 워터마크, UI 장식은 추가하지 않는다.
- 페이지 번호와 파일명을 바꾸지 않는다.
`;

export const buildCodexHandoffFiles = ({
  seriesPlan,
  imageSize,
  comicMode,
  codexImageQuality,
  codexImageModel,
  pageStyleOverrides,
  pageResults,
  useCrossPageStyleConsistency
}: BuildCodexHandoffFilesParams): Record<string, string | Uint8Array> => {
  const files: Record<string, string | Uint8Array> = {};
  const referencePathByDataUrl = new Map<string, string>();
  const pages: HandoffPageManifestEntry[] = [];

  const getReferencePath = (dataUrl: string): string | null => {
    const parsed = parseDataUrl(dataUrl);
    if (!parsed) return null;

    const existing = referencePathByDataUrl.get(dataUrl);
    if (existing) return existing;

    const index = referencePathByDataUrl.size + 1;
    const extension = extensionFromMimeType(parsed.mimeType);
    const path = `references/ref-${String(index).padStart(3, "0")}.${extension}`;
    referencePathByDataUrl.set(dataUrl, path);
    files[path] = bytesFromBase64(parsed.base64);
    return path;
  };

  for (const page of seriesPlan.pages) {
    const pageIndex = page.page.index;
    const styleOverride = pageStyleOverrides[pageIndex] || null;
    const resolvedSeriesSpec: SeriesSpec = styleOverride
      ? {
          ...seriesPlan.series_spec,
          anchors: { ...seriesPlan.series_spec.anchors, style: styleOverride }
        }
      : seriesPlan.series_spec;
    const request = buildFullPageImageRequest(resolvedSeriesSpec, page, imageSize, comicMode, {
      imageProvider: "codex",
      codexImageQuality,
      codexImageModel,
      styleConsistencyImage: getStyleConsistencyImage(
        page,
        pageResults,
        useCrossPageStyleConsistency,
        Boolean(styleOverride)
      )
    });
    const pageSlug = `page-${padPageIndex(pageIndex)}`;
    const referenceFiles = request.referenceImages
      .map((dataUrl) => getReferencePath(dataUrl))
      .filter((path): path is string => Boolean(path));
    const entry: HandoffPageManifestEntry = {
      page_index: pageIndex,
      chapter_title: page.page.chapter_title,
      prompt_file: `prompts/${pageSlug}.md`,
      output_file: `outputs/${pageSlug}.png`,
      reference_files: referenceFiles,
      model: request.codexImageModel,
      size: request.codexSize,
      quality: request.codexImageQuality
    };

    pages.push(entry);
    files[entry.prompt_file] = buildPromptMarkdown(entry, request.prompt);
  }

  const manifest = {
    schema_version: 1,
    generated_at: new Date().toISOString(),
    project_title: seriesPlan.series_spec.series.title || "Toon for Codex",
    source: "Toon for Codex Handoff",
    pages
  };

  files["manifest.json"] = `${JSON.stringify(manifest, null, 2)}\n`;
  files["instructions.md"] = buildInstructionsMarkdown(manifest);
  files["outputs/README.md"] = "Codex-generated PNG files should be saved here as page-001.png, page-002.png, ...\n";

  return files;
};
