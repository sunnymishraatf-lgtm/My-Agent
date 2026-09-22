import { readProjectFile } from "../files/project-files";
import type { TurnSnapshot } from "./snapshots";

export type DiffKind = "added" | "deleted" | "modified" | "unchanged";

export interface FileDiff {
  path: string;
  kind: DiffKind;
  before: string | null;
  after: string | null;
}

const MAX_LINES = 3000;

function splitLines(text: string): string[] {
  return text.length === 0 ? [] : text.replace(/\r\n/g, "\n").split("\n");
}

/** Compute a unified diff for a single file using an LCS table. */
export function unifiedDiff(before: string, after: string, path: string, context = 3): string {
  const a = splitLines(before);
  const b = splitLines(after);

  if (a.length > MAX_LINES || b.length > MAX_LINES) {
    if (before === after) return "";
    return [
      `--- a/${path}`,
      `+++ b/${path}`,
      `@@ -1,${a.length} +1,${b.length} @@`,
      ...a.map((l) => `-${l}`),
      ...b.map((l) => `+${l}`),
    ].join("\n");
  }

  const n = a.length;
  const m = b.length;
  const lcs: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      lcs[i]![j] = a[i] === b[j] ? lcs[i + 1]![j + 1]! + 1 : Math.max(lcs[i + 1]![j]!, lcs[i]![j + 1]!);
    }
  }

  type Op = { type: " " | "-" | "+"; text: string; aLine: number; bLine: number };
  const ops: Op[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      ops.push({ type: " ", text: a[i]!, aLine: i + 1, bLine: j + 1 });
      i++;
      j++;
    } else if (lcs[i + 1]![j]! >= lcs[i]![j + 1]!) {
      ops.push({ type: "-", text: a[i]!, aLine: i + 1, bLine: j + 1 });
      i++;
    } else {
      ops.push({ type: "+", text: b[j]!, aLine: i + 1, bLine: j + 1 });
      j++;
    }
  }
  while (i < n) {
    ops.push({ type: "-", text: a[i]!, aLine: i + 1, bLine: m + 1 });
    i++;
  }
  while (j < m) {
    ops.push({ type: "+", text: b[j]!, aLine: n + 1, bLine: j + 1 });
    j++;
  }

  const changed = ops
    .map((op, idx) => (op.type === " " ? -1 : idx))
    .filter((idx) => idx >= 0);
  if (changed.length === 0) return "";

  const hunks: { start: number; end: number }[] = [];
  for (const idx of changed) {
    const start = Math.max(0, idx - context);
    const end = Math.min(ops.length - 1, idx + context);
    const last = hunks[hunks.length - 1];
    if (last && start <= last.end + 1) last.end = Math.max(last.end, end);
    else hunks.push({ start, end });
  }

  const out: string[] = [`--- a/${path}`, `+++ b/${path}`];
  for (const hunk of hunks) {
    const slice = ops.slice(hunk.start, hunk.end + 1);
    const aStart = slice.find((op) => op.type !== "+")?.aLine ?? 0;
    const bStart = slice.find((op) => op.type !== "-")?.bLine ?? 0;
    const aCount = slice.filter((op) => op.type !== "+").length;
    const bCount = slice.filter((op) => op.type !== "-").length;
    out.push(`@@ -${aStart},${aCount} +${bStart},${bCount} @@`);
    for (const op of slice) out.push(`${op.type}${op.text}`);
  }
  return out.join("\n");
}

export function diffTurn(root: string, turn: TurnSnapshot): FileDiff[] {
  const diffs: FileDiff[] = [];
  for (const [path, before] of Object.entries(turn.files)) {
    const current = readProjectFile(root, path);
    const after = current === undefined ? null : current;
    if (before === null && after === null) continue;
    if (before === after) {
      diffs.push({ path, kind: "unchanged", before, after });
      continue;
    }
    const kind: DiffKind = before === null ? "added" : after === null ? "deleted" : "modified";
    diffs.push({ path, kind, before, after });
  }
  return diffs;
}

export function formatDiff(diffs: FileDiff[]): string {
  const parts: string[] = [];
  for (const diff of diffs) {
    if (diff.kind === "unchanged") continue;
    const patch = unifiedDiff(diff.before ?? "", diff.after ?? "", diff.path);
    if (patch) parts.push(patch);
  }
  return parts.join("\n");
}
