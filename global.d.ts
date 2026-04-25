/// <reference types="vite/client" />

export {};

declare global {
  interface ImportMetaEnv {
    readonly VITE_MAX_PAGE_COUNT?: string;
    readonly VITE_GEMINI_MAX_OUTPUT_TOKENS?: string;
    readonly VITE_GEMINI_MAX_PAGES_PER_REQUEST?: string;
  }

  interface Window {
    aistudio?: {
      hasSelectedApiKey: () => Promise<boolean>;
      openSelectKey: () => Promise<void>;
    };
  }
}
