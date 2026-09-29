/* Type declarations for palette.js (command palette + universal search).
   The runtime is vanilla JS with the same dual IIFE pattern as ui-utils.js. */

export interface PaletteCtx {
  go: (hash: string) => void;
  openUrl: (url: string) => void;
  copy: (text: string) => Promise<boolean>;
  toast: (msg: string) => void;
  announce: (msg: string) => void;
  app: Record<string, any>;
  setSession: (k: string, v: string) => void;
}

export interface PaletteResultEntry {
  key?: string;
  group: string;
  title?: string;
  detail?: string;
  text?: string;
  body?: string;
  ts?: number;
  ref?: any;
}

declare const api: {
  open: () => boolean;
  close: () => void;
  toggle: () => void;
  isOpen: () => boolean;
  runPaletteCommand: (id: string, ctx?: Partial<PaletteCtx>) => boolean;
  paletteCommandIds: () => string[];
  openPaletteResult: (entry: PaletteResultEntry | null | undefined, ctx?: Partial<PaletteCtx>) => boolean;
};

export default api;
