import React from "react";
import { Plus, Save, Trash2, Wand2, X } from "lucide-react";
import type { PageSpec } from "../types";

type Props = {
  open: boolean;
  page: PageSpec | null;
  uiLanguage?: "ko" | "en";
  isBusy?: boolean;
  onClose: () => void;
  onChange: (next: PageSpec) => void;
  onSave: () => void;
  onSaveAndRedraw?: () => void;
};

export const PageScriptEditorModal: React.FC<Props> = ({
  open,
  page,
  uiLanguage = "ko",
  isBusy,
  onClose,
  onChange,
  onSave,
  onSaveAndRedraw
}) => {
  if (!open || !page) return null;
  const ui = (ko: string, en: string) => uiLanguage === "ko" ? ko : en;

  const updateTitle = (chapter_title: string) => {
    onChange({ ...page, page: { ...page.page, chapter_title } });
  };

  const updatePanel = (panelIndex: number, patch: Partial<PageSpec["panels"][number]>) => {
    onChange({
      ...page,
      panels: page.panels.map((p) => (p.index === panelIndex ? { ...p, ...patch } : p))
    });
  };

  const updateDialogue = (panelIndex: number, dialogueIndex: number, value: string) => {
    const panel = page.panels.find((p) => p.index === panelIndex);
    if (!panel) return;
    const nextDialogues = panel.dialogues.map((d, idx) => (idx === dialogueIndex ? value : d));
    updatePanel(panelIndex, { dialogues: nextDialogues });
  };

  const addDialogue = (panelIndex: number) => {
    const panel = page.panels.find((p) => p.index === panelIndex);
    if (!panel) return;
    updatePanel(panelIndex, { dialogues: [...panel.dialogues, ""] });
  };

  const removeDialogue = (panelIndex: number, dialogueIndex: number) => {
    const panel = page.panels.find((p) => p.index === panelIndex);
    if (!panel) return;
    updatePanel(panelIndex, { dialogues: panel.dialogues.filter((_, idx) => idx !== dialogueIndex) });
  };

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/50">
      <div className="bg-white border-4 border-black comic-shadow w-full max-w-4xl max-h-[90vh] flex flex-col">
        <div className="p-4 md:p-5 border-b-2 border-black flex items-start justify-between gap-4">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <span className="bg-blue-600 text-white px-2 py-0.5 text-[10px] font-black uppercase italic">
                PAGE {page.page.index}
              </span>
              <span className="text-[10px] font-bold text-slate-500 uppercase">{ui("스크립트 편집", "Script Editor")}</span>
            </div>
            <p className="text-xs font-bold text-slate-500 mt-2">
              {ui("대사/장면을 수정한 뒤, 이 페이지를 다시 그릴 수 있어.", "Edit the scene and dialogue, then redraw this page.")}
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
            <label className="block text-[10px] font-black uppercase text-slate-500 mb-2">{ui("페이지 제목", "Page Title")}</label>
            <input
              value={String(page.page.chapter_title ?? "")}
              onChange={(e) => updateTitle(e.target.value)}
              className="w-full px-3 py-2 text-sm font-bold border-2 border-black bg-white outline-none focus:bg-yellow-50"
              placeholder={ui("예) 핵심 원리 한 줄 요약", "Example: One-line summary of the core idea")}
            />
          </div>

          {page.panels.map((panel) => (
            <div key={panel.index} className="bg-white border-2 border-black p-4 md:p-5">
              <div className="flex items-center justify-between gap-4 mb-4">
                <div className="min-w-0">
                  <div className="inline-block bg-black text-white px-2 py-0.5 text-[10px] font-black uppercase italic">
                    CUT {panel.index}
                  </div>
                  <p className="text-[10px] font-bold text-slate-500 mt-2">
                    {ui("이 컷의 상황/연기/카메라/무드/대사를 직접 다듬어줘.", "Fine-tune the scene, acting, camera, mood, and dialogue for this cut.")}
                  </p>
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-[10px] font-black uppercase text-slate-500 mb-2">{ui("상황(장면)", "Scene")}</label>
                  <textarea
                    value={String(panel.scene ?? "")}
                    onChange={(e) => updatePanel(panel.index, { scene: e.target.value })}
                    className="w-full min-h-[90px] px-3 py-2 text-xs font-bold border-2 border-black bg-white outline-none focus:bg-yellow-50 resize-y"
                    placeholder={ui("무슨 일이 일어나고 있어?", "What is happening?")}
                  />
                </div>

                <div>
                  <label className="block text-[10px] font-black uppercase text-slate-500 mb-2">{ui("연기(표정/제스처)", "Acting")}</label>
                  <textarea
                    value={String(panel.acting ?? "")}
                    onChange={(e) => updatePanel(panel.index, { acting: e.target.value })}
                    className="w-full min-h-[90px] px-3 py-2 text-xs font-bold border-2 border-black bg-white outline-none focus:bg-yellow-50 resize-y"
                    placeholder={ui("표정, 손짓, 몸짓 등", "Facial expression, gestures, body language")}
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-4">
                <div>
                  <label className="block text-[10px] font-black uppercase text-slate-500 mb-2">{ui("카메라", "Camera")}</label>
                  <input
                    value={String(panel.camera ?? "")}
                    onChange={(e) => updatePanel(panel.index, { camera: e.target.value })}
                    className="w-full px-3 py-2 text-xs font-bold border-2 border-black bg-white outline-none focus:bg-yellow-50"
                    placeholder={ui("예) medium shot, close-up, wide shot...", "Example: medium shot, close-up, wide shot...")}
                  />
                </div>
                <div>
                  <label className="block text-[10px] font-black uppercase text-slate-500 mb-2">{ui("무드", "Mood")}</label>
                  <input
                    value={String(panel.mood ?? "")}
                    onChange={(e) => updatePanel(panel.index, { mood: e.target.value })}
                    className="w-full px-3 py-2 text-xs font-bold border-2 border-black bg-white outline-none focus:bg-yellow-50"
                    placeholder={ui("예) 밝고 경쾌 / 긴장감 / 차분함...", "Example: bright, tense, calm...")}
                  />
                </div>
              </div>

              <div className="mt-5 bg-slate-50 border-2 border-black p-4">
                <div className="flex items-center justify-between gap-4 mb-3">
                  <label className="block text-[10px] font-black uppercase text-slate-500">{ui("말풍선 대사", "Speech Bubble Lines")}</label>
                  <button
                    type="button"
                    onClick={() => addDialogue(panel.index)}
                    className="border-2 border-black bg-white hover:bg-yellow-100 px-2 py-1 text-[10px] font-black uppercase flex items-center gap-1"
                    title={ui("대사 줄 추가", "Add dialogue line")}
                  >
                    <Plus size={12} /> {ui("추가", "Add")}
                  </button>
                </div>

                {panel.dialogues.length === 0 ? (
                  <p className="text-[10px] font-bold text-slate-500">{ui("대사가 없어. 추가 버튼으로 줄을 넣을 수 있어.", "No dialogue yet. Use Add to create a line.")}</p>
                ) : (
                  <div className="space-y-2">
                    {panel.dialogues.map((line, idx) => (
                      <div key={idx} className="flex items-start gap-2">
                        <div className="mt-2 text-[10px] font-black text-slate-400 w-6 text-right">{idx + 1}</div>
                        <input
                          value={String(line ?? "")}
                          onChange={(e) => updateDialogue(panel.index, idx, e.target.value)}
                          className="flex-1 px-3 py-2 text-xs font-bold border-2 border-black bg-white outline-none focus:bg-yellow-50"
                          placeholder={ui("말풍선에 들어갈 문장", "Text for the speech bubble")}
                        />
                        <button
                          type="button"
                          onClick={() => removeDialogue(panel.index, idx)}
                          className="border-2 border-black bg-white hover:bg-red-50 px-2 py-2"
                          title={ui("이 줄 삭제", "Remove this line")}
                          aria-label={ui("대사 삭제", "Remove dialogue")}
                        >
                          <Trash2 size={14} />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          ))}
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
              onClick={onSave}
              className="border-2 border-black px-4 py-2 text-xs font-black uppercase flex items-center gap-2 bg-white hover:bg-yellow-100"
              title={ui("스크립트 저장", "Save script")}
            >
              <Save size={14} /> {ui("저장", "Save")}
            </button>
            {onSaveAndRedraw && (
              <button
                type="button"
                onClick={onSaveAndRedraw}
                disabled={Boolean(isBusy)}
                className={`border-2 border-black px-4 py-2 text-xs font-black uppercase flex items-center gap-2 ${
                  isBusy ? "bg-slate-200 text-slate-400 cursor-not-allowed" : "bg-blue-600 text-white hover:bg-black"
                }`}
                title={ui("저장 후 이 페이지를 재생성", "Save and redraw this page")}
              >
                <Wand2 size={14} /> {ui("저장 후 재생성", "Save & Redraw")}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
