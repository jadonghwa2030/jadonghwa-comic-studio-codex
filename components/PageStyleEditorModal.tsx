import React, { useEffect, useMemo, useState } from "react";
import { RefreshCcw, Save, Wand2, X, CheckCircle2 } from "lucide-react";
import type { SeriesSpec, StylePreset } from "../types";
import { getStylePresetDisplayLabel, selectStyle } from "../services/styleService";
import { readImageFileAsCompressedDataUrl } from "../services/imageDataUrl";

type ApplyScope = "page" | "all";
const STYLE_REFERENCE_MAX_EDGE = 1024;
const STYLE_REFERENCE_MAX_LENGTH = 300_000;
const STYLE_REFERENCE_JPEG_QUALITY = 0.82;

type Props = {
  open: boolean;
  pageIndex: number | null;
  uiLanguage?: "ko" | "en";
  presets: StylePreset[];
  initialStyle: SeriesSpec["anchors"]["style"] | null;
  hasPageOverride?: boolean;
  isBusy?: boolean;
  onClose: () => void;
  onClearPageOverride?: () => void;
  onSave: (style: SeriesSpec["anchors"]["style"], scope: ApplyScope, opts: { redraw: boolean }) => void;
};

export const PageStyleEditorModal: React.FC<Props> = ({
  open,
  pageIndex,
  uiLanguage = "ko",
  presets,
  initialStyle,
  hasPageOverride,
  isBusy,
  onClose,
  onClearPageOverride,
  onSave
}) => {
  const canRender = open && pageIndex && initialStyle;
  const resolvedUiLanguage: "ko" | "en" = uiLanguage === "en" ? "en" : "ko";
  const ui = (ko: string, en: string) => resolvedUiLanguage === "ko" ? ko : en;
  const [selectedPresetId, setSelectedPresetId] = useState<string>("");
  const [styleReferenceImage, setStyleReferenceImage] = useState<string | null>(null);
  const [styleReferenceError, setStyleReferenceError] = useState<string | null>(null);
  const [applyScope, setApplyScope] = useState<ApplyScope>("page");
  const [selectedCategory, setSelectedCategory] = useState<string>("Webtoon");

  useEffect(() => {
    if (!open || !initialStyle) return;
    const matchedPreset = presets.find((p) => p.id === initialStyle.preset_id);
    const initialCategory = matchedPreset?.category || "Uncategorized";
    setSelectedPresetId(initialStyle.preset_id);
    setSelectedCategory(initialCategory);
    setStyleReferenceImage(initialStyle.style_reference_image || null);
    setStyleReferenceError(null);
    setApplyScope("page");
  }, [open, initialStyle, presets]);

  const resolvedStyle = useMemo(() => {
    if (!presets || presets.length === 0) return null;
    if (!selectedPresetId) return null;
    try {
      return {
        ...selectStyle(presets, selectedPresetId, ""),
        style_reference_image: styleReferenceImage
      } as SeriesSpec["anchors"]["style"];
    } catch {
      return null;
    }
  }, [presets, selectedPresetId, styleReferenceImage]);

  /* ------------------------------------------------------------------
   * CATEGORIES
   * ------------------------------------------------------------------ */
  const allCategories = useMemo(() => {
    const set = new Set<string>();
    presets.forEach((p) => {
      set.add(p.category || "Uncategorized");
    });
    // Create a fixed order if valuable, otherwise just sort
    const ordered = ["Webtoon", "Anime", "Manga", "Illustration", "3D/Craft", "Realism", "Uncategorized"];
    return ordered.filter((c) => set.has(c));
  }, [presets]);

  // Fallback if the initially selected category disappears or isn't in list
  useEffect(() => {
    if (allCategories.length > 0 && !allCategories.includes(selectedCategory)) {
      setSelectedCategory(allCategories[0]);
    }
  }, [allCategories, selectedCategory]);

  const filteredPresets = useMemo(() => {
    return presets.filter((p) => (p.category || "Uncategorized") === selectedCategory);
  }, [presets, selectedCategory]);

  const readStyleReferenceFile = async (file: File): Promise<string> => {
    const dataUrl = await readImageFileAsCompressedDataUrl(file, {
      maxEdge: STYLE_REFERENCE_MAX_EDGE,
      maxLength: STYLE_REFERENCE_MAX_LENGTH,
      quality: STYLE_REFERENCE_JPEG_QUALITY,
    });
    if (dataUrl.startsWith("data:") && dataUrl.length > STYLE_REFERENCE_MAX_LENGTH) {
      throw new Error(ui("스타일 이미지를 저장 가능한 크기로 줄이지 못했어. 더 작은 PNG/JPG 이미지를 올려줘.", "Could not shrink the style image enough to save. Upload a smaller PNG/JPG image."));
    }
    return dataUrl;
  };

  useEffect(() => {
    if (filteredPresets.length === 0) return;
    if (!filteredPresets.some((p) => p.id === selectedPresetId)) {
      setSelectedPresetId(filteredPresets[0].id);
    }
  }, [filteredPresets, selectedPresetId]);


  if (!canRender) return null;

  return (
    <div className="fixed inset-0 z-[110] flex items-center justify-center p-4 bg-black/50">
      <div className="bg-white border-4 border-black comic-shadow w-full max-w-5xl max-h-[90vh] flex flex-col">
        {/* HEADER */}
        <div className="p-4 md:p-5 border-b-2 border-black flex items-start justify-between gap-4">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <span className="bg-blue-600 text-white px-2 py-0.5 text-[10px] font-black uppercase italic">
                PAGE {pageIndex}
              </span>
              <span className="text-[10px] font-bold text-slate-500 uppercase">{ui("스타일 편집", "Style Editor")}</span>
              {hasPageOverride ? (
                <span className="bg-yellow-200 text-black border-2 border-black px-2 py-0.5 text-[9px] font-black uppercase">
                  {ui("개별 적용", "Override")}
                </span>
              ) : null}
            </div>
            <p className="text-xs font-bold text-slate-500 mt-2">{ui("그림체/스타일을 바꾸고 적용 범위를 선택해줘.", "Change the art style and choose where to apply it.")}</p>
          </div>

          <button
            type="button"
            onClick={onClose}
            className="border-2 border-black bg-white hover:bg-slate-100 px-2 py-2"
            aria-label={ui("닫기", "Close")}
          >
            <X size={16} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto">
          <div className="p-4 md:p-6 space-y-6">

            {/* APPLY SCOPE */}
            <div className="bg-slate-50 border-2 border-black p-4">
              <p className="text-[10px] font-black uppercase text-slate-600 mb-2">{ui("적용 범위", "Apply Scope")}</p>
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => setApplyScope("page")}
                  className={`py-2 border-2 border-black font-black text-[10px] uppercase transition-colors ${applyScope === "page" ? "bg-black text-white" : "bg-white hover:bg-slate-100"
                    }`}
                >
                  {ui("이 페이지만", "This Page")}
                </button>
                <button
                  type="button"
                  onClick={() => setApplyScope("all")}
                  className={`py-2 border-2 border-black font-black text-[10px] uppercase transition-colors ${applyScope === "all" ? "bg-blue-600 text-white border-blue-600" : "bg-white hover:bg-slate-100"
                    }`}
                >
                  {ui("전체 페이지", "All Pages")}
                </button>
              </div>
              <p className="text-[10px] font-bold text-slate-500 mt-2">
                {ui("전체 페이지로 적용하면, 상단의 전체 재생성 토글로 1페이지부터 덮어쓰며 다시 그릴 수 있어.", "Apply to all pages, then use the Regenerate All toggle to redraw from page 1.")}
              </p>

              {hasPageOverride && onClearPageOverride ? (
                <div className="mt-3">
                  <button
                    type="button"
                    onClick={onClearPageOverride}
                    className="border-2 border-black bg-white hover:bg-yellow-100 px-3 py-2 text-[10px] font-black uppercase flex items-center gap-2"
                    title={ui("이 페이지의 스타일 오버라이드 제거", "Remove this page style override")}
                  >
                    <RefreshCcw size={14} /> {ui("이 페이지 스타일 초기화", "Reset Page Style")}
                  </button>
                </div>
              ) : null}
            </div>

            {/* STYLE CATEGORIES & LIST */}
            <div>
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-sm font-black uppercase">{ui("그림체 프리셋", "Art Style Presets")}</h3>
              </div>

              {/* TABS */}
              <div className="flex flex-wrap gap-2 mb-4">
                {allCategories.map((cat) => (
                  <button
                    key={cat}
                    type="button"
                    onClick={() => setSelectedCategory(cat)}
                    className={`px-4 py-2 text-[10px] md:text-xs font-black uppercase border-2 transition-all rounded-full ${selectedCategory === cat
                      ? "bg-black text-white border-black scale-105"
                      : "bg-white text-slate-500 border-slate-300 hover:border-black hover:text-black"
                      }`}
                  >
                    {cat}
                  </button>
                ))}
              </div>

              {/* PRESETS GRID */}
              {presets.length === 0 ? (
                <p className="text-xs font-bold text-slate-500">{ui("스타일 프리셋을 불러오는 중이야...", "Loading style presets...")}</p>
              ) : (
                <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
                  {filteredPresets.map((p) => (
                    <div
                      key={p.id}
                      onClick={() => setSelectedPresetId(p.id)}
                      className={`p-4 border-4 cursor-pointer transition-all flex flex-col h-full ${selectedPresetId === p.id
                        ? "border-blue-600 bg-blue-50 scale-[1.02] shadow-md"
                        : "border-slate-200 hover:border-black hover:bg-white"
                        }`}
                    >
                      <h4 className={`font-black text-xs md:text-sm mb-2 uppercase ${selectedPresetId === p.id ? "text-blue-700" : "text-black"}`}>
                        {getStylePresetDisplayLabel(p, resolvedUiLanguage)}
                      </h4>
                      <div className="flex-1">
                        <p className="text-[10px] font-bold text-slate-500 leading-tight">
                          {p.preview_hint}
                        </p>
                      </div>
                      {selectedPresetId === p.id && (
                        <div className="mt-3 flex justify-end">
                          <CheckCircle2 size={16} className="text-blue-600" />
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>


            <div className="p-6 bg-slate-50 border-2 border-black">
              <p className="text-xs font-black text-slate-700 uppercase mb-2">{ui("스타일 레퍼런스(선택)", "Style Reference (Optional)")}</p>
              <p className="text-[10px] font-bold text-slate-500 leading-relaxed mb-4">
                {ui("원하는 그림체/질감/채색 레퍼런스를 업로드하면 생성 시 스타일 참고용으로 함께 전달돼.", "Upload an art, texture, or coloring reference and it will be used during generation.")}
              </p>

              <input
                type="file"
                accept="image/*"
                id="page-style-up"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  setStyleReferenceError(null);
                  if (!f) return;

                  if (f.size > 6 * 1024 * 1024) {
                    setStyleReferenceError(ui("이미지 용량이 너무 커. 6MB 이하로 업로드해줘.", "Image is too large. Upload an image under 6MB."));
                    setStyleReferenceImage(null);
                    e.currentTarget.value = "";
                    return;
                  }

                  void readStyleReferenceFile(f)
                    .then((dataUrl) => setStyleReferenceImage(dataUrl))
                    .catch((error: any) => {
                      setStyleReferenceError(error?.message || ui("이미지를 불러오지 못했어.", "Could not load the image."));
                      setStyleReferenceImage(null);
                    });
                  e.currentTarget.value = "";
                }}
              />

              {styleReferenceError ? (
                <p className="text-[10px] font-black text-red-600 mb-3">{styleReferenceError}</p>
              ) : null}

              {!styleReferenceImage ? (
                <label
                  htmlFor="page-style-up"
                  className="inline-block bg-black text-white px-6 py-3 font-black cursor-pointer hover:bg-blue-600 transition-colors text-[10px] md:text-xs"
                >
                  {ui("스타일 이미지 업로드", "Upload Style Image")}
                </label>
              ) : (
                <div className="flex flex-col md:flex-row gap-4 items-start">
                  <div className="w-40 h-40 border-4 border-black overflow-hidden bg-white">
                    <img src={styleReferenceImage} alt="Style reference" className="w-full h-full object-cover" />
                  </div>
                  <div className="flex gap-2">
                    <label
                      htmlFor="page-style-up"
                      className="bg-black text-white px-4 py-2 font-black cursor-pointer hover:bg-blue-600 transition-colors text-[10px] md:text-xs"
                    >
                      {ui("변경", "Change")}
                    </label>
                    <button
                      type="button"
                      onClick={() => {
                        setStyleReferenceImage(null);
                        setStyleReferenceError(null);
                      }}
                      className="border-2 border-black bg-white px-4 py-2 font-black hover:bg-slate-100 text-[10px] md:text-xs"
                    >
                      {ui("지우기", "Clear")}
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>

        <div className="p-4 md:p-5 border-t-2 border-black bg-slate-50 flex items-center justify-between gap-3">
          <button
            type="button"
            onClick={onClose}
            className="border-2 border-black bg-white hover:bg-slate-100 px-4 py-2 text-xs font-black uppercase"
          >
            {ui("취소", "Cancel")}
          </button>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => {
                if (!resolvedStyle) return;
                onSave(resolvedStyle, applyScope, { redraw: false });
              }}
              className="border-2 border-black px-4 py-2 text-xs font-black uppercase flex items-center gap-2 bg-white hover:bg-yellow-100"
              title={ui("스타일 저장", "Save style")}
              disabled={!resolvedStyle}
            >
              <Save size={14} /> {ui("저장", "Save")}
            </button>
            <button
              type="button"
              onClick={() => {
                if (!resolvedStyle) return;
                onSave(resolvedStyle, applyScope, { redraw: true });
              }}
              disabled={!resolvedStyle || Boolean(isBusy)}
              className={`border-2 border-black px-4 py-2 text-xs font-black uppercase flex items-center gap-2 ${!resolvedStyle || isBusy ? "bg-slate-200 text-slate-400 cursor-not-allowed" : "bg-blue-600 text-white hover:bg-black"
                }`}
              title={ui("저장 후 이 페이지를 재생성", "Save and redraw this page")}
            >
              <Wand2 size={14} /> {ui("저장 후 재생성", "Save & Redraw")}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
