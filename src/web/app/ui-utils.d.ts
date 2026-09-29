/* Type declarations for the plain-JS UI utilities (loaded as a classic script). */
export declare const CHAT_RENDER_CAP: number;

export interface DebouncedFunction {
  (...args: any[]): void;
  cancel(): void;
}

export declare function debounce<T extends (...args: any[]) => void>(
  fn: T,
  wait: number
): DebouncedFunction;

export declare function cappedSlice<T>(arr: T[] | null | undefined, cap: number): T[];

export declare function shouldRefreshPill(
  lastMs: number,
  nowMs: number,
  intervalMs: number
): boolean;
