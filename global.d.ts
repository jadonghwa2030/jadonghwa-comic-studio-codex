/// <reference types="vite/client" />

export {};

declare global {
  interface ImportMetaEnv {
    readonly VITE_MAX_PAGE_COUNT?: string;
    readonly VITE_CODEX_MAX_OUTPUT_TOKENS?: string;
    readonly VITE_CODEX_MAX_PAGES_PER_REQUEST?: string;
    readonly VITE_GEMINI_PLANNER_MODEL?: string;
    readonly VITE_GEMINI_RESEARCH_MODEL?: string;
    readonly VITE_GEMINI_TEXT_MODEL?: string;
    readonly VITE_CODEX_PLANNER_MODEL?: string;
    readonly VITE_CODEX_PLANNER_MAX_OUTPUT_TOKENS?: string;
    readonly VITE_CODEX_RESEARCH_MODEL?: string;
    readonly VITE_CODEX_RESEARCH_MAX_OUTPUT_TOKENS?: string;
  }

  interface Window {
    aistudio?: {
      hasSelectedApiKey: () => Promise<boolean>;
      openSelectKey: () => Promise<void>;
    };
  }
}
