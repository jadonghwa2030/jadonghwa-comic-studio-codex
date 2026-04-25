import { GenerationResult, ImageSize, PageSpec, WebtoonEpisodeRenderResult } from "../types";

const BASE_WEBTOON_WIDTH = 800;
const SEGMENT_MAX_HEIGHT_BY_IMAGE_SIZE: Record<ImageSize, number> = {
  "1K": 4096,
  "2K": 8192,
  "4K": 12288,
};

type LoadedPage = {
  image: HTMLImageElement;
  pageIndex: number;
  drawHeight: number;
  gapAfterPx: number;
};

const loadImage = (src: string): Promise<HTMLImageElement> =>
  new Promise((resolve, reject) => {
    const image = new Image();
    image.crossOrigin = "anonymous";
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("웹툰 페이지 이미지를 읽지 못했습니다."));
    image.src = src;
  });

const scaleGapPx = (page: PageSpec, targetWidth: number): number => {
  const baseGap = Math.max(0, Math.round(page.layout.scroll?.gap_after_px || 0));
  const baseWidth = Math.max(1, page.layout.canvas?.w || BASE_WEBTOON_WIDTH);
  return Math.max(0, Math.round((baseGap / baseWidth) * targetWidth));
};

const buildFallbackEpisodeResult = (
  availablePages: PageSpec[],
  resultMap: Map<number, GenerationResult>,
  totalHeightEstimate = 0
): WebtoonEpisodeRenderResult | null => {
  const fallbackSegments = availablePages
    .map((page) => ({
      pageIndex: page.page.index,
      url: resultMap.get(page.page.index)?.composed_image_url || "",
    }))
    .filter((segment) => Boolean(segment.url));

  if (fallbackSegments.length === 0) return null;

  return {
    segment_urls: fallbackSegments.map((segment) => segment.url),
    source_page_indices: fallbackSegments.map((segment) => [segment.pageIndex]),
    total_height_estimate: totalHeightEstimate,
  };
};

export const composeWebtoonEpisodeSegments = async (
  pages: PageSpec[],
  pageResults: GenerationResult[],
  imageSize: ImageSize
): Promise<WebtoonEpisodeRenderResult | null> => {
  if (!Array.isArray(pages) || pages.length === 0) return null;
  if (!Array.isArray(pageResults) || pageResults.length === 0) return null;

  const resultMap = new Map(pageResults.map((result) => [result.page_index, result]));
  const availablePages = pages.filter((page) => resultMap.has(page.page.index));
  if (availablePages.length === 0) return null;

  try {
    const images = await Promise.all(
      availablePages.map((page) => loadImage(resultMap.get(page.page.index)!.composed_image_url))
    );

    const targetWidth = Math.max(
      BASE_WEBTOON_WIDTH,
      ...images.map((image) => image.naturalWidth || image.width || BASE_WEBTOON_WIDTH)
    );
    const loadedPages: LoadedPage[] = availablePages.map((page, index) => {
      const image = images[index];
      const sourceWidth = Math.max(1, image.naturalWidth || image.width || targetWidth);
      const sourceHeight = Math.max(1, image.naturalHeight || image.height || targetWidth);
      const drawHeight = Math.max(1, Math.round((sourceHeight / sourceWidth) * targetWidth));
      return {
        image,
        pageIndex: page.page.index,
        drawHeight,
        gapAfterPx: scaleGapPx(page, targetWidth),
      };
    });

    const maxSegmentHeight = SEGMENT_MAX_HEIGHT_BY_IMAGE_SIZE[imageSize] || SEGMENT_MAX_HEIGHT_BY_IMAGE_SIZE["1K"];
    const segments: LoadedPage[][] = [];
    let currentSegment: LoadedPage[] = [];
    let currentSegmentHeight = 0;
    let totalHeightEstimate = 0;

    loadedPages.forEach((loadedPage, index) => {
      const isLastEpisodePage = index === loadedPages.length - 1;
      const gapAfterPx = isLastEpisodePage ? 0 : loadedPage.gapAfterPx;
      const nextHeight = loadedPage.drawHeight + gapAfterPx;
      if (currentSegment.length > 0 && currentSegmentHeight + nextHeight > maxSegmentHeight) {
        segments.push(currentSegment);
        currentSegment = [];
        currentSegmentHeight = 0;
      }
      currentSegment.push({ ...loadedPage, gapAfterPx });
      currentSegmentHeight += nextHeight;
      totalHeightEstimate += nextHeight;
    });

    if (currentSegment.length > 0) {
      segments.push(currentSegment);
    }

    const segment_urls = segments.map((segment) => {
      const segmentHeight = segment.reduce((sum, page) => sum + page.drawHeight + page.gapAfterPx, 0);
      const canvas = document.createElement("canvas");
      canvas.width = targetWidth;
      canvas.height = Math.max(1, segmentHeight);
      const context = canvas.getContext("2d");
      if (!context) throw new Error("웹툰 세그먼트 캔버스를 만들지 못했습니다.");

      context.fillStyle = "#ffffff";
      context.fillRect(0, 0, canvas.width, canvas.height);

      let offsetY = 0;
      for (const page of segment) {
        context.drawImage(page.image, 0, offsetY, targetWidth, page.drawHeight);
        offsetY += page.drawHeight;
        if (page.gapAfterPx > 0) {
          context.fillStyle = "#ffffff";
          context.fillRect(0, offsetY, targetWidth, page.gapAfterPx);
          offsetY += page.gapAfterPx;
        }
      }

      return canvas.toDataURL("image/png");
    });

    return {
      segment_urls,
      source_page_indices: segments.map((segment) => segment.map((page) => page.pageIndex)),
      total_height_estimate: totalHeightEstimate,
    };
  } catch (error) {
    console.warn("Webtoon episode compose fallback: showing page images directly.", error);
    return buildFallbackEpisodeResult(availablePages, resultMap);
  }
};
