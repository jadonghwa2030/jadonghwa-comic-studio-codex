import React from "react";
import type { PageSpec } from "../types";

type Props = {
  page: PageSpec;
  uiLanguage?: "ko" | "en";
  compact?: boolean;
  className?: string;
  showHeader?: boolean;
  isI2V?: boolean;
};

type DialogueKind = "speech" | "thought" | "narration";

const parseDialogueLine = (raw: string): { kind: DialogueKind; text: string } => {
  const trimmed = String(raw ?? "").trim();
  if (!trimmed) return { kind: "speech", text: "" };
  if (trimmed.startsWith("[thought]")) {
    return { kind: "thought", text: trimmed.slice("[thought]".length).trim() };
  }
  if (trimmed.startsWith("[narration]")) {
    return { kind: "narration", text: trimmed.slice("[narration]".length).trim() };
  }
  return { kind: "speech", text: trimmed };
};

const DIALOGUE_KIND_META: Record<
  DialogueKind,
  { label: string; chipClass: string; boxClass: string }
> = {
  speech: {
    label: "대사",
    chipClass: "bg-slate-900 text-white",
    boxClass: "bg-white",
  },
  thought: {
    label: "생각",
    chipClass: "bg-sky-200 text-sky-950",
    boxClass: "bg-sky-50",
  },
  narration: {
    label: "나레이션",
    chipClass: "bg-amber-200 text-amber-950",
    boxClass: "bg-amber-50",
  },
};

export const PageNarrativePreview: React.FC<Props> = ({
  page,
  uiLanguage = "ko",
  compact = false,
  className = "",
  showHeader = false,
  isI2V = false,
}) => {
  const ui = (ko: string, en: string) => uiLanguage === "ko" ? ko : en;
  const dialogueMeta: Record<DialogueKind, { label: string; chipClass: string; boxClass: string }> = {
    speech: { ...DIALOGUE_KIND_META.speech, label: ui("대사", "Dialogue") },
    thought: { ...DIALOGUE_KIND_META.thought, label: ui("생각", "Thought") },
    narration: { ...DIALOGUE_KIND_META.narration, label: ui("나레이션", "Narration") },
  };
  const wrapperClass = compact ? "space-y-2" : "space-y-3";
  const cardPaddingClass = compact ? "p-3" : "p-4";
  const sceneTextClass = compact
    ? "text-[11px] md:text-xs"
    : "text-xs md:text-sm";
  const dialogueTextClass = compact
    ? "text-[11px] md:text-xs"
    : "text-xs md:text-sm";
  const metaTextClass = compact ? "text-[10px]" : "text-[11px]";

  return (
    <div className={`space-y-3 ${className}`.trim()}>
      {showHeader ? (
        <div className="flex items-center justify-between gap-2">
          <div>
            <p className="text-[10px] font-black uppercase text-slate-500">
              {ui("장면 텍스트 모드", "Scene Text Mode")}
            </p>
            <p className="text-[10px] font-bold text-slate-500 mt-1">
              {ui("상황 설명도 텍스트로 같이 읽는 모드", "Read scene descriptions alongside the image.")}
            </p>
          </div>
          <span className="border-2 border-black bg-white px-2 py-0.5 text-[10px] font-black uppercase text-slate-600">
            {page.panels.length} {ui("컷", "cuts")}
          </span>
        </div>
      ) : null}

      <div className={wrapperClass}>
        {page.panels.map((panel) => {
          const metaItems = [
            ...(isI2V ? [
              { label: ui("동작 단계", "Action Phase"), value: String(panel.action_phase ?? "").trim() },
              { label: ui("연결 시작", "Continuity In"), value: String(panel.i2v_continuity_in ?? "").trim() },
              { label: ui("시작 자세", "Start Pose"), value: String(panel.start_pose ?? "").trim() },
              { label: ui("영상 방향", "Motion"), value: String(panel.motion_continuation ?? "").trim() },
              { label: ui("연결 끝", "Continuity Out"), value: String(panel.i2v_continuity_out ?? "").trim() },
            ] : []),
            { label: ui("연기", "Acting"), value: String(panel.acting ?? "").trim() },
            { label: ui("카메라", "Camera"), value: String(panel.camera ?? "").trim() },
            { label: ui("무드", "Mood"), value: String(panel.mood ?? "").trim() },
          ].filter((item) => item.value);

          return (
            <div
              key={`page_${page.page.index}_panel_${panel.index}`}
              className={`border-2 border-black bg-white ${cardPaddingClass}`}
            >
              <div className="flex items-center justify-between gap-2 mb-2">
                <span className="bg-black text-white px-2 py-0.5 text-[10px] font-black uppercase italic">
                  {ui("컷", "Cut")} {panel.index}
                </span>
                <span className="text-[10px] font-black uppercase text-slate-400">
                  {panel.dialogues.length} {ui("줄", "lines")}
                </span>
              </div>

              <div className="border-2 border-black bg-slate-50 p-3">
                <p className="text-[10px] font-black uppercase text-slate-500 mb-2">
                  {ui("상황 설명", "Scene")}
                </p>
                <p className={`font-bold leading-relaxed text-slate-800 ${sceneTextClass}`}>
                  {String(panel.scene ?? "").trim() || ui("아직 장면 설명이 비어 있어.", "No scene description yet.")}
                </p>
              </div>

              {metaItems.length > 0 ? (
                <div className="mt-2 flex flex-wrap gap-2">
                  {metaItems.map((item) => (
                    <div
                      key={`${panel.index}_${item.label}`}
                      className="border-2 border-black bg-slate-50 px-2 py-1"
                    >
                      <p className="text-[10px] font-black uppercase text-slate-500">
                        {item.label}
                      </p>
                      <p className={`font-bold text-slate-700 ${metaTextClass}`}>
                        {item.value}
                      </p>
                    </div>
                  ))}
                </div>
              ) : null}

              <div className="mt-3 space-y-2">
                {panel.dialogues.length > 0 ? (
                  panel.dialogues.map((line, idx) => {
                    const parsed = parseDialogueLine(line);
                    const meta = dialogueMeta[parsed.kind];
                    return (
                      <div
                        key={`dialogue_${panel.index}_${idx}`}
                        className={`border-2 border-black p-3 ${meta.boxClass}`}
                      >
                        <div className="flex items-center gap-2 mb-2">
                          <span
                            className={`px-2 py-0.5 text-[10px] font-black uppercase border-2 border-black ${meta.chipClass}`}
                          >
                            {meta.label}
                          </span>
                          <span className="text-[10px] font-black uppercase text-slate-400">
                            {ui("줄", "Line")} {idx + 1}
                          </span>
                        </div>
                        <p
                          className={`font-bold leading-relaxed text-slate-900 ${dialogueTextClass}`}
                        >
                          {parsed.text || ui("빈 대사", "Empty dialogue")}
                        </p>
                      </div>
                    );
                  })
                ) : (
                  <div className="border-2 border-dashed border-slate-300 bg-slate-50 px-3 py-4">
                    <p className="text-[10px] font-bold text-slate-500 uppercase">
                      {ui("무대사 컷", "Silent cut")}
                    </p>
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};
