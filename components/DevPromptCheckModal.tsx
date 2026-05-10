import React, { useEffect, useMemo, useState } from "react";
import { Copy, X } from "lucide-react";
import type { GroundingSource, SeriesPlan } from "../types";

type Props = {
  open: boolean;
  plan: SeriesPlan | null;
  settingsSummary: string;
  uiLanguage?: "ko" | "en";
  onClose: () => void;
};

const formatSources = (sources: GroundingSource[]) => {
  if (sources.length === 0) return "(none)";
  return sources.map((s, idx) => `${idx + 1}. ${s.title}\n   ${s.uri}`).join("\n");
};

export const DevPromptCheckModal: React.FC<Props> = ({ open, plan, settingsSummary, uiLanguage = "ko", onClose }) => {
  const ui = (ko: string, en: string) => uiLanguage === "ko" ? ko : en;
  const [includeResearchPack, setIncludeResearchPack] = useState(true);
  const [includeSources, setIncludeSources] = useState(true);
  const [copied, setCopied] = useState(false);
  const [copyError, setCopyError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setIncludeResearchPack(true);
    setIncludeSources(true);
    setCopied(false);
    setCopyError(null);
  }, [open]);

  const debug = plan?.debug || null;
  const sources = (plan?.plan_meta?.grounding_sources || []) as GroundingSource[];

  const contentsPreview = useMemo(() => {
    if (!debug) return "";
    const blocks = debug.chunks.map((c, idx) => {
      const isOutlinePass = c.start_index === 0 && c.end_index === 0 && c.include_plan_meta;
      const label = isOutlinePass
        ? `--- OUTLINE PASS ---\nenable_search: ${c.enable_search}\n`
        : `--- CHUNK ${idx + 1} (p${c.start_index}~p${c.end_index}) ---\ninclude_plan_meta: ${c.include_plan_meta}\nenable_search: ${c.enable_search}\n`;
      return `${label}\n${includeResearchPack ? c.contents_with_research : c.contents_without_research}`;
    });
    return blocks.join("\n\n");
  }, [debug, includeResearchPack]);

  const resultJsonPreview = useMemo(() => {
    if (!debug) return "";
    const payload = {
      model: debug.model,
      created_at: debug.created_at,
      chunks: debug.chunks.map((c) => ({
        start_index: c.start_index,
        end_index: c.end_index,
        include_plan_meta: c.include_plan_meta,
        enable_search: c.enable_search,
        response_json: c.response_json
      }))
    };
    return JSON.stringify(payload, null, 2);
  }, [debug]);

  const copyText = useMemo(() => {
    const lines: string[] = [];
    lines.push(uiLanguage === "ko" ? "[설정 요약]" : "[SETTINGS SUMMARY]");
    lines.push(settingsSummary.trim() || "(empty)");
    lines.push("");

    if (!debug) {
      lines.push("[DEV PROMPT LOG]");
      lines.push("(missing: this plan was generated without debug logs)");
      return lines.join("\n");
    }

    lines.push("[SYSTEM_INSTRUCTION]");
    lines.push(debug.system_instruction || "(empty)");
    lines.push("");

    lines.push("[CONTENTS]");
    lines.push(contentsPreview || "(empty)");
    lines.push("");

    lines.push("[RESULT_JSON]");
    lines.push(resultJsonPreview || "(empty)");
    lines.push("");

    if (includeSources) {
      lines.push("[SOURCES]");
      lines.push(formatSources(sources));
      lines.push("");
    }

    return lines.join("\n");
  }, [contentsPreview, debug, includeSources, resultJsonPreview, settingsSummary, sources, uiLanguage]);

  const handleCopy = async () => {
    setCopied(false);
    setCopyError(null);
    try {
      await navigator.clipboard.writeText(copyText);
      setCopied(true);
    } catch (e: any) {
      setCopyError(e?.message || ui("클립보드 복사에 실패했어.", "Clipboard copy failed."));
    }
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[130] flex items-center justify-center p-4 bg-black/50">
      <div className="bg-white border-4 border-black comic-shadow w-full max-w-5xl max-h-[90vh] flex flex-col">
        <div className="p-4 md:p-5 border-b-2 border-black flex items-start justify-between gap-4">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <span className="bg-black text-white px-2 py-0.5 text-[10px] font-black uppercase italic">DEV</span>
              <span className="text-[10px] font-bold text-slate-500 uppercase">{ui("프롬프트 체크", "Prompt Check")}</span>
            </div>
            <p className="text-xs font-bold text-slate-500 mt-2">
              {ui("프롬프트/결과를 복사해 이슈 공유와 재현에 사용할 수 있어.", "Copy prompts and results for issue sharing and reproduction.")}
            </p>
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

        <div className="p-4 md:p-6 overflow-y-auto space-y-4">
          <div className="bg-slate-50 border-2 border-black p-4">
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
              <div className="flex flex-wrap items-center gap-4">
                <label className="flex items-center gap-2 text-[10px] font-black uppercase text-slate-600">
                  <input
                    type="checkbox"
                    checked={includeResearchPack}
                    onChange={(e) => setIncludeResearchPack(e.target.checked)}
                    className="w-4 h-4 border-2 border-black"
                  />
                  {ui("리서치 팩 포함", "Include Research Pack")}
                </label>
                <label className="flex items-center gap-2 text-[10px] font-black uppercase text-slate-600">
                  <input
                    type="checkbox"
                    checked={includeSources}
                    onChange={(e) => setIncludeSources(e.target.checked)}
                    className="w-4 h-4 border-2 border-black"
                  />
                  {ui("참고 링크 포함", "Include Sources")}
                </label>
              </div>

              <button
                type="button"
                onClick={handleCopy}
                className="border-2 border-black bg-white hover:bg-yellow-100 px-4 py-2 text-[10px] font-black uppercase flex items-center gap-2"
                title={ui("현재 옵션 기준으로 전체 텍스트 복사", "Copy all text with current options")}
              >
                <Copy size={14} /> {ui("전체 복사", "Copy All")}
              </button>
            </div>

            <p className="text-[10px] font-bold text-slate-500 mt-2">
              {ui("공유 전 개인정보/민감정보가 없는지만 한 번 확인해줘.", "Before sharing, check for personal or sensitive information.")}
            </p>
            {copied ? (
              <p className="text-[10px] font-black text-green-700 mt-2">{ui("복사됨.", "Copied.")}</p>
            ) : null}
            {copyError ? (
              <p className="text-[10px] font-black text-red-700 mt-2">{copyError}</p>
            ) : null}
          </div>

          <details open className="border-2 border-black bg-white">
            <summary className="cursor-pointer select-none px-4 py-3 font-black text-xs uppercase bg-slate-100 border-b-2 border-black">
              {ui("설정 요약", "Settings Summary")}
            </summary>
            <pre className="p-4 text-[11px] whitespace-pre-wrap font-mono">{settingsSummary.trim() || "(empty)"}</pre>
          </details>

          <details className="border-2 border-black bg-white">
            <summary className="cursor-pointer select-none px-4 py-3 font-black text-xs uppercase bg-slate-100 border-b-2 border-black">
              [SYSTEM_INSTRUCTION]
            </summary>
            <pre className="p-4 text-[11px] whitespace-pre-wrap font-mono">
              {debug?.system_instruction || "(missing)"}
            </pre>
          </details>

          <details className="border-2 border-black bg-white">
            <summary className="cursor-pointer select-none px-4 py-3 font-black text-xs uppercase bg-slate-100 border-b-2 border-black">
              [CONTENTS]
            </summary>
            <pre className="p-4 text-[11px] whitespace-pre-wrap font-mono">{contentsPreview || "(missing)"}</pre>
          </details>

          <details className="border-2 border-black bg-white">
            <summary className="cursor-pointer select-none px-4 py-3 font-black text-xs uppercase bg-slate-100 border-b-2 border-black">
              [RESULT_JSON]
            </summary>
            <pre className="p-4 text-[11px] whitespace-pre-wrap font-mono">{resultJsonPreview || "(missing)"}</pre>
          </details>

          {includeSources ? (
            <details className="border-2 border-black bg-white">
              <summary className="cursor-pointer select-none px-4 py-3 font-black text-xs uppercase bg-slate-100 border-b-2 border-black">
                [SOURCES]
              </summary>
              <pre className="p-4 text-[11px] whitespace-pre-wrap font-mono">{formatSources(sources)}</pre>
            </details>
          ) : null}
        </div>

        <div className="p-4 md:p-5 border-t-2 border-black bg-slate-50 flex justify-end">
          <button
            type="button"
            onClick={onClose}
            className="border-2 border-black bg-white hover:bg-slate-100 px-4 py-2 text-xs font-black uppercase"
          >
            {ui("닫기", "Close")}
          </button>
        </div>
      </div>
    </div>
  );
};
