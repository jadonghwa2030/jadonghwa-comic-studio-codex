import React from "react";
import { FileText, Palette, X } from "lucide-react";

type Props = {
  open: boolean;
  pageIndex: number | null;
  uiLanguage?: "ko" | "en";
  onClose: () => void;
  onEditScript: () => void;
  onEditStyle: () => void;
};

export const PageEditActionModal: React.FC<Props> = ({ open, pageIndex, uiLanguage = "ko", onClose, onEditScript, onEditStyle }) => {
  if (!open || !pageIndex) return null;
  const ui = (ko: string, en: string) => uiLanguage === "ko" ? ko : en;

  return (
    <div className="fixed inset-0 z-[110] flex items-center justify-center p-4 bg-black/50">
      <div className="bg-white border-4 border-black comic-shadow w-full max-w-sm">
        <div className="p-4 border-b-2 border-black flex items-start justify-between gap-4">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <span className="bg-blue-600 text-white px-2 py-0.5 text-[10px] font-black uppercase italic">
                PAGE {pageIndex}
              </span>
              <span className="text-[10px] font-bold text-slate-500 uppercase">{ui("수정", "Edit")}</span>
            </div>
            <p className="text-xs font-bold text-slate-500 mt-2">{ui("무엇을 수정할까?", "What do you want to edit?")}</p>
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

        <div className="p-4 space-y-2">
          <button
            type="button"
            onClick={onEditScript}
            className="w-full border-2 border-black bg-white hover:bg-yellow-100 px-4 py-3 font-black text-xs uppercase flex items-center gap-2 justify-center"
          >
            <FileText size={16} /> {ui("상황/대사", "Scene & Dialogue")}
          </button>
          <button
            type="button"
            onClick={onEditStyle}
            className="w-full border-2 border-black bg-white hover:bg-blue-50 px-4 py-3 font-black text-xs uppercase flex items-center gap-2 justify-center"
          >
            <Palette size={16} /> {ui("그림체/스타일", "Art Style")}
          </button>
        </div>

        <div className="p-4 border-t-2 border-black bg-slate-50 flex justify-end">
          <button
            type="button"
            onClick={onClose}
            className="border-2 border-black bg-white hover:bg-slate-100 px-4 py-2 text-xs font-black uppercase"
          >
            {ui("취소", "Cancel")}
          </button>
        </div>
      </div>
    </div>
  );
};
