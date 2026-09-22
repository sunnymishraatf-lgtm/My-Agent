/**
 * Terminal key classification for text editing.
 *
 * Why this exists: Ink 5's `useInput` cannot tell Backspace from Delete.
 * Nearly every terminal sends 0x7F for the Backspace key, and Ink reports that
 * as `key.delete` (only a literal 0x08 becomes `key.backspace`). The real
 * forward-Delete key sends `ESC [ 3 ~`, which Ink *also* reports as
 * `key.delete`. Branching on `key.backspace` / `key.delete` alone therefore
 * either makes Backspace do nothing at end-of-line (delete-forward) or makes
 * Delete act like Backspace. We classify from the raw bytes instead.
 *
 * Ink also has no Home/End flags, so those are detected here as well.
 */
import { useEffect, useRef } from "react";
import { useStdin } from "ink";

export type EditKind = "backspace" | "delete" | "home" | "end" | "wordLeft" | "wordRight" | null;

/** Classify a raw terminal chunk. Returns null for anything that is not an editing key. */
export function classifyRaw(seq: string): EditKind {
  if (seq === "\x7f" || seq === "\b" || seq === "\x1b\x7f" || seq === "\x1b\b") return "backspace";
  // ESC [ 3 ~  (Delete), with optional modifier: ESC [ 3 ; 5 ~ (Ctrl+Delete). Also rxvt variants ESC [ 3 $ / ^ / @.
  if (/^\x1b\[3(;\d+)?[~$^@]$/.test(seq)) return "delete";
  if (seq === "\x1b[H" || seq === "\x1bOH" || seq === "\x1b[1~" || seq === "\x1b[7~") return "home";
  if (seq === "\x1b[F" || seq === "\x1bOF" || seq === "\x1b[4~" || seq === "\x1b[8~") return "end";
  // Ctrl/Alt + Left/Right jump by word.
  if (seq === "\x1b[1;5D" || seq === "\x1b[1;3D" || seq === "\x1bb") return "wordLeft";
  if (seq === "\x1b[1;5C" || seq === "\x1b[1;3C" || seq === "\x1bf") return "wordRight";
  return null;
}

/**
 * Decide what an Ink key event means for a text field.
 * `raw` is the last raw chunk seen by {@link useRawKeys}; without it (or if it
 * is unrecognised) an Ink `delete` is treated as Backspace, because that is
 * what the physical Backspace key produces on virtually all terminals.
 */
export function editKind(key: { backspace?: boolean; delete?: boolean }, raw: string): EditKind {
  const fromRaw = classifyRaw(raw);
  if (fromRaw) return fromRaw;
  if (key.backspace || key.delete) return "backspace";
  return null;
}

/** Tracks the most recent raw stdin chunk. Call once per component that edits text. */
export function useRawKeys(): { current: string } {
  const { internal_eventEmitter: emitter } = useStdin();
  const last = useRef("");
  useEffect(() => {
    if (!emitter) return;
    const onData = (data: unknown) => {
      last.current = typeof data === "string" ? data : String(data);
    };
    // Prepend so we run before any `useInput` handler registered on the same emitter.
    emitter.prependListener("input", onData);
    return () => {
      emitter.removeListener("input", onData);
    };
  }, [emitter]);
  return last;
}

/** Pure text-editing helpers (cursor-preserving). */
export interface EditResult {
  text: string;
  cursor: number;
}

export function insertAt(text: string, cursor: number, insert: string): EditResult {
  const at = clamp(cursor, text.length);
  return { text: text.slice(0, at) + insert + text.slice(at), cursor: at + insert.length };
}

export function backspaceAt(text: string, cursor: number): EditResult {
  const at = clamp(cursor, text.length);
  if (at === 0) return { text, cursor: 0 };
  return { text: text.slice(0, at - 1) + text.slice(at), cursor: at - 1 };
}

export function deleteAt(text: string, cursor: number): EditResult {
  const at = clamp(cursor, text.length);
  if (at >= text.length) return { text, cursor: at };
  return { text: text.slice(0, at) + text.slice(at + 1), cursor: at };
}

export function wordLeft(text: string, cursor: number): number {
  let i = clamp(cursor, text.length);
  while (i > 0 && /\s/.test(text[i - 1]!)) i--;
  while (i > 0 && !/\s/.test(text[i - 1]!)) i--;
  return i;
}

export function wordRight(text: string, cursor: number): number {
  let i = clamp(cursor, text.length);
  while (i < text.length && /\s/.test(text[i]!)) i++;
  while (i < text.length && !/\s/.test(text[i]!)) i++;
  return i;
}

/** Normalise pasted text: unify newlines, strip control characters except \n and \t. */
export function sanitizePaste(text: string): string {
  return text
    .replace(/\x1b\[20[01]~/g, "") // bracketed-paste markers
    .replace(/\r\n?/g, "\n")
    .replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g, "");
}

/**
 * Split one raw stdin chunk into individual key tokens.
 *
 * Why this exists: a terminal can deliver several keystrokes in a single
 * stdin chunk — key repeat (holding Backspace), fast typing, laggy SSH, and
 * mobile soft keyboards all coalesce bytes. Ink parses the whole chunk as ONE
 * keypress, so everything after the first key is silently dropped: Backspace
 * appears to do nothing, arrows don't move, typed characters vanish.
 * Tokenising here lets the caller handle each key in order.
 *
 * Escape sequences are matched greedily: CSI (`ESC [ … final`), SS3
 * (`ESC O letter`), then `ESC` + one char (Alt+key). A trailing incomplete
 * sequence is left for the next chunk by emitting the lone `ESC` as its own
 * token, which callers already treat as the Escape key.
 */
export function splitRawKeys(chunk: string): string[] {
  const tokens: string[] = [];
  let i = 0;
  while (i < chunk.length) {
    if (chunk[i] !== "\x1b") {
      tokens.push(chunk[i]!);
      i++;
      continue;
    }
    const rest = chunk.slice(i);
    // CSI: ESC [ params intermediates final (e.g. \x1b[D, \x1b[3~, \x1b[1;5D, \x1b[200~)
    const csi = rest.match(/^\x1b\[[0-9;:?]*[ -/]*[@-~]/);
    if (csi) {
      tokens.push(csi[0]);
      i += csi[0].length;
      continue;
    }
    // SS3: ESC O letter (application cursor-key mode, e.g. \x1bOD)
    const ss3 = rest.match(/^\x1bO[A-Za-z]/);
    if (ss3) {
      tokens.push(ss3[0]);
      i += 3;
      continue;
    }
    if (rest.length >= 2) {
      // Alt+key (ESC + one char), e.g. \x1b\x7f
      tokens.push(rest.slice(0, 2));
      i += 2;
      continue;
    }
    // Lone trailing ESC.
    tokens.push("\x1b");
    i++;
  }
  return tokens;
}

/** Key flags for a single token, mirroring the subset of Ink's key object the TUI reads. */
export interface TokenKey {
  upArrow?: boolean;
  downArrow?: boolean;
  leftArrow?: boolean;
  rightArrow?: boolean;
  pageUp?: boolean;
  pageDown?: boolean;
  return?: boolean;
  escape?: boolean;
  tab?: boolean;
  ctrl?: boolean;
  meta?: boolean;
  shift?: boolean;
  backspace?: boolean;
  delete?: boolean;
}

/**
 * Interpret one token the way Ink's `useInput` would for a single keypress.
 * Returns the printable `input` ("" for special keys) plus key flags.
 * Unknown escape sequences produce no input so stray terminal noise can never
 * inject text into the input box.
 */
export function parseToken(token: string): { input: string; key: TokenKey } {
  const key: TokenKey = {};
  const kind = classifyRaw(token);
  if (kind === "backspace") {
    key.backspace = true;
    return { input: "", key };
  }
  if (kind === "delete") {
    key.delete = true;
    return { input: "", key };
  }
  switch (token) {
    case "\x1b[A":
    case "\x1bOA":
      key.upArrow = true;
      return { input: "", key };
    case "\x1b[B":
    case "\x1bOB":
      key.downArrow = true;
      return { input: "", key };
    case "\x1b[C":
    case "\x1bOC":
      key.rightArrow = true;
      return { input: "", key };
    case "\x1b[D":
    case "\x1bOD":
      key.leftArrow = true;
      return { input: "", key };
    case "\x1b[5~":
      key.pageUp = true;
      return { input: "", key };
    case "\x1b[6~":
      key.pageDown = true;
      return { input: "", key };
    case "\r":
      key.return = true;
      return { input: "", key };
    case "\n":
      // Ink reports LF as "enter" (not "return") and passes it through as
      // input, so multi-line pastes keep their newlines instead of submitting.
      return { input: "\n", key };
    case "\t":
      key.tab = true;
      return { input: "", key };
    case "\x1b[Z": // shift+tab
      key.tab = true;
      key.shift = true;
      return { input: "", key };
    case "\x1b":
      key.escape = true;
      key.meta = true;
      return { input: "", key };
    case "\x1b[200~":
    case "\x1b[201~": // bracketed-paste markers carry no text themselves
      return { input: "", key };
  }
  if (token.length === 1 && token <= "\x1a") {
    // C0 control character -> Ctrl+letter, mirroring Ink (input is the letter).
    // \x08 (backspace), \x09 (tab) and \x0d (return) are handled above.
    key.ctrl = true;
    return { input: String.fromCharCode(token.charCodeAt(0) + 96), key };
  }
  if (token.length === 2 && token[0] === "\x1b") {
    // Alt+key.
    key.meta = true;
    return { input: token[1]!, key };
  }
  if (token[0] === "\x1b") {
    // Any other escape sequence is terminal noise: never insert it as text.
    return { input: "", key };
  }
  return { input: token, key };
}

function clamp(n: number, len: number): number {
  return Math.max(0, Math.min(len, n));
}
