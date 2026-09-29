/**
 * Checkpoints — before the IMPLEMENT phase, the agent snapshots every file it
 * is about to touch. The UI offers Restore on the final report, so working
 * code is never silently destroyed.
 */

import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { randomBytes } from "node:crypto";
import { dirname, join } from "node:path";
import { resolveSafePath, SKIP_DIRS, ToolError } from "./tools";

/** Checkpoint ids are single path segments — no traversal, no slashes. */
export const CHECKPOINT_ID_RE = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/;

function assertCheckpointId(id: string): void {
  if (typeof id !== "string" || !CHECKPOINT_ID_RE.test(id)) {
    throw new ToolError("BAD_ID", "Invalid checkpoint id.");
  }
}

function checkpointDir(repoRoot: string, runId: string): string {
  return join(repoRoot, ".agent", "checkpoints", runId);
}

export type CheckpointKind = "run" | "manual";

export interface CheckpointMeta {
  id: string;
  kind: CheckpointKind;
  label: string;
  at: string;
  fileCount: number;
}

interface ManifestFile { path: string; existed: boolean }
interface Manifest {
  id: string;
  kind: CheckpointKind;
  label: string;
  at: string;
  files: ManifestFile[];
}

/** Read a checkpoint manifest. Tolerates the legacy {runId, at, files} shape. */
function readManifest(repoRoot: string, id: string): Manifest {
  assertCheckpointId(id);
  const manifestPath = join(checkpointDir(repoRoot, id), "manifest.json");
  if (!existsSync(manifestPath)) throw new ToolError("NO_CHECKPOINT", "Checkpoint not found.");
  let parsed: any;
  try {
    parsed = JSON.parse(readFileSync(manifestPath, "utf8"));
  } catch {
    throw new ToolError("NO_CHECKPOINT", "Checkpoint manifest is unreadable.");
  }
  const files = Array.isArray(parsed.files) ? parsed.files : [];
  return {
    id: typeof parsed.id === "string" ? parsed.id : (typeof parsed.runId === "string" ? parsed.runId : id),
    kind: parsed.kind === "manual" ? "manual" : "run",
    label: typeof parsed.label === "string" ? parsed.label : "",
    at: typeof parsed.at === "string" ? parsed.at : "",
    files: files.filter((f: any) => f && typeof f.path === "string").map((f: any) => ({
      path: f.path,
      existed: f.existed === true,
    })),
  };
}

function writeManifest(
  repoRoot: string,
  id: string,
  kind: CheckpointKind,
  label: string,
  files: ManifestFile[],
): void {
  const dir = checkpointDir(repoRoot, id);
  mkdirSync(dir, { recursive: true });
  const manifest: Manifest = { id, kind, label, at: new Date().toISOString(), files };
  writeFileSync(join(dir, "manifest.json"), JSON.stringify(manifest, null, 2));
}

function metaOf(m: Manifest): CheckpointMeta {
  return { id: m.id, kind: m.kind, label: m.label, at: m.at, fileCount: m.files.length };
}

/** Snapshot the given relative paths (missing files are recorded as absent). */
export function snapshotFiles(
  repoRoot: string,
  runId: string,
  relPaths: string[],
  opts: { kind?: CheckpointKind; label?: string } = {},
): { snapshotted: string[] } {
  assertCheckpointId(runId);
  const dir = checkpointDir(repoRoot, runId);
  mkdirSync(dir, { recursive: true });
  const manifest: ManifestFile[] = [];
  const seen = new Set<string>();
  for (const rel of relPaths) {
    if (seen.has(rel)) continue;
    seen.add(rel);
    let abs: string;
    try {
      abs = resolveSafePath(repoRoot, rel);
    } catch {
      manifest.push({ path: rel, existed: false });
      continue;
    }
    const dest = join(dir, rel + ".bak");
    if (existsSync(abs) && statSync(abs).isFile()) {
      mkdirSync(dirname(dest), { recursive: true });
      writeFileSync(dest, readFileSync(abs));
      manifest.push({ path: rel, existed: true });
    } else {
      manifest.push({ path: rel, existed: false });
    }
  }
  writeManifest(repoRoot, runId, opts.kind ?? "run", opts.label ?? "", manifest);
  return { snapshotted: manifest.filter((m) => m.existed).map((m) => m.path) };
}

export interface CheckpointFile { path: string; existed: boolean }

/** List what a checkpoint contains. */
export function listCheckpoint(repoRoot: string, runId: string): CheckpointFile[] {
  return readManifest(repoRoot, runId).files;
}

/** Restore every snapshotted file. Returns the restored paths. */
export function restoreCheckpoint(repoRoot: string, runId: string): { restored: string[]; deleted: string[] } {
  const dir = checkpointDir(repoRoot, runId);
  const files = listCheckpoint(repoRoot, runId);
  const restored: string[] = [];
  const deleted: string[] = [];
  for (const f of files) {
    const abs = resolveSafePath(repoRoot, f.path);
    if (f.existed) {
      const bak = join(dir, f.path + ".bak");
      if (!existsSync(bak)) continue;
      mkdirSync(dirname(abs), { recursive: true });
      writeFileSync(abs, readFileSync(bak));
      restored.push(f.path);
    } else if (existsSync(abs) && statSync(abs).isFile()) {
      // File did not exist at snapshot time: remove what the agent created.
      unlinkSync(abs);
      deleted.push(f.path);
    }
  }
  return { restored, deleted };
}

/** Best-effort cleanup of a checkpoint directory. */
export function pruneCheckpoint(repoRoot: string, runId: string): void {
  try {
    assertCheckpointId(runId);
    rmSync(checkpointDir(repoRoot, runId), { recursive: true, force: true });
  } catch { /* best-effort */ }
}

export function checkpointExists(repoRoot: string, runId: string): boolean {
  try {
    assertCheckpointId(runId);
  } catch {
    return false;
  }
  return existsSync(join(checkpointDir(repoRoot, runId), "manifest.json"));
}

/** Relative paths recorded in the manifest (for the final report UI). */
export function checkpointFiles(repoRoot: string, runId: string): string[] {
  try {
    return listCheckpoint(repoRoot, runId).map((f) => f.path);
  } catch {
    return [];
  }
}

/* ------------------------------------------------------------------ */
/* Generalized checkpoint service: manual checkpoints, compare,        */
/* per-file restore, and restore that can never silently destroy work. */
/* ------------------------------------------------------------------ */

const MAX_CP_FILES = 500;
const MAX_CP_TOTAL_BYTES = 10 * 1024 * 1024;
const MAX_CP_FILE_BYTES = 2 * 1024 * 1024;
const MAX_LABEL_LEN = 120;
const MANUAL_KEEP = 20;
const MAX_COMPARE_FILE_BYTES = 200 * 1024;

function newCheckpointId(): string {
  return "cp-" + randomBytes(9).toString("hex");
}

/** Heuristic: no NUL byte in the first 8KB → treat as text. */
function isProbablyText(buf: Buffer): boolean {
  const n = Math.min(buf.length, 8192);
  for (let i = 0; i < n; i++) {
    if (buf[i] === 0) return false;
  }
  return true;
}

/** All text files under the repo root, sorted, honoring the skip list. */
function collectTextFiles(repoRoot: string): { files: string[]; skippedLarge: number; skippedBinary: number } {
  const out: string[] = [];
  let skippedLarge = 0;
  let skippedBinary = 0;
  let totalBytes = 0;
  const walk = (dir: string, rel: string): boolean => {
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return true;
    }
    entries.sort((a, b) => a.name.localeCompare(b.name));
    for (const e of entries) {
      if (SKIP_DIRS.has(e.name) || e.name === ".agent") continue;
      const r = rel ? rel + "/" + e.name : e.name;
      const p = join(dir, e.name);
      if (e.isDirectory()) {
        if (!walk(p, r)) return false;
      } else if (e.isFile()) {
        let st;
        try { st = statSync(p); } catch { continue; }
        if (st.size > MAX_CP_FILE_BYTES) { skippedLarge++; continue; }
        let head: Buffer;
        try { head = readFileSync(p).subarray(0, 8192); } catch { continue; }
        if (!isProbablyText(head)) { skippedBinary++; continue; }
        if (out.length >= MAX_CP_FILES || totalBytes + st.size > MAX_CP_TOTAL_BYTES) return false;
        out.push(r);
        totalBytes += st.size;
      }
    }
    return true;
  };
  walk(repoRoot, "");
  return { files: out, skippedLarge, skippedBinary };
}

export interface ManualCheckpointResult {
  id: string;
  label: string;
  at: string;
  fileCount: number;
  skippedLarge: number;
  skippedBinary: number;
}

/**
 * Create a user-facing checkpoint: snapshots every text file in the repo
 * (capped). Auto-prunes older manual checkpoints to the newest 20.
 */
export function createManualCheckpoint(repoRoot: string, label: string): ManualCheckpointResult {
  const clean = (typeof label === "string" ? label : "").trim().slice(0, MAX_LABEL_LEN);
  if (!clean) throw new ToolError("BAD_LABEL", "A checkpoint label is required.");
  const collected = collectTextFiles(repoRoot);
  const id = newCheckpointId();
  const r = snapshotFiles(repoRoot, id, collected.files, { kind: "manual", label: clean });
  pruneManualCheckpoints(repoRoot, MANUAL_KEEP);
  const m = readManifest(repoRoot, id);
  return {
    id,
    label: clean,
    at: m.at,
    fileCount: r.snapshotted.length,
    skippedLarge: collected.skippedLarge,
    skippedBinary: collected.skippedBinary,
  };
}

/** Newest-first metadata for every checkpoint in the repo. */
export function listCheckpoints(repoRoot: string): CheckpointMeta[] {
  const base = join(repoRoot, ".agent", "checkpoints");
  let entries: string[];
  try {
    entries = readdirSync(base, { withFileTypes: true })
      .filter((e) => e.isDirectory())
      .map((e) => e.name);
  } catch {
    return [];
  }
  const out: CheckpointMeta[] = [];
  for (const id of entries) {
    try {
      out.push(metaOf(readManifest(repoRoot, id)));
    } catch { /* unreadable manifest — skip, don't break the list */ }
  }
  out.sort((a, b) => (b.at || "").localeCompare(a.at || ""));
  return out;
}

/** Full checkpoint detail: metadata + file list. */
export function getCheckpoint(repoRoot: string, id: string): CheckpointMeta & { files: ManifestFile[] } {
  const m = readManifest(repoRoot, id);
  return { ...metaOf(m), files: m.files };
}

/** Delete a checkpoint (manual or run). Throws NO_CHECKPOINT when missing. */
export function deleteCheckpoint(repoRoot: string, id: string): { deleted: string } {
  readManifest(repoRoot, id); // validates id + existence
  rmSync(checkpointDir(repoRoot, id), { recursive: true, force: true });
  return { deleted: id };
}

/** Keep only the newest `keep` manual checkpoints; run checkpoints are untouched. */
export function pruneManualCheckpoints(repoRoot: string, keep: number = MANUAL_KEEP): { pruned: string[] } {
  const manuals = listCheckpoints(repoRoot)
    .filter((m) => m.kind === "manual")
    .sort((a, b) => (a.at || "").localeCompare(b.at || ""));
  const pruned: string[] = [];
  for (const m of manuals.slice(0, Math.max(0, manuals.length - keep))) {
    try {
      rmSync(checkpointDir(repoRoot, m.id), { recursive: true, force: true });
      pruned.push(m.id);
    } catch { /* best-effort */ }
  }
  return { pruned };
}

/**
 * Read one file's content from a checkpoint. Returns null content when the
 * file did not exist at snapshot time. Throws NO_CHECKPOINT / UNKNOWN_FILE.
 */
export function readCheckpointFile(
  repoRoot: string,
  id: string,
  relPath: string,
): { existed: boolean; content: string | null; note?: string } {
  const m = readManifest(repoRoot, id);
  const entry = m.files.find((f) => f.path === relPath);
  if (!entry) throw new ToolError("UNKNOWN_FILE", `File is not part of this checkpoint: ${relPath}`);
  if (!entry.existed) return { existed: false, content: null };
  const bak = join(checkpointDir(repoRoot, id), relPath + ".bak");
  if (!existsSync(bak)) return { existed: true, content: null, note: "snapshot file missing" };
  const buf = readFileSync(bak);
  if (buf.length > MAX_COMPARE_FILE_BYTES || !isProbablyText(buf)) {
    return { existed: true, content: null, note: "too large or binary to read" };
  }
  return { existed: true, content: buf.toString("utf8") };
}

/** Restore a single file from a checkpoint (revert one file, leave the rest). */
export function restoreCheckpointFile(
  repoRoot: string,
  id: string,
  relPath: string,
): { path: string; reverted: boolean; deleted: boolean } {
  const m = readManifest(repoRoot, id);
  const entry = m.files.find((f) => f.path === relPath);
  if (!entry) throw new ToolError("UNKNOWN_FILE", `File is not part of this checkpoint: ${relPath}`);
  const abs = resolveSafePath(repoRoot, relPath);
  if (entry.existed) {
    const bak = join(checkpointDir(repoRoot, id), relPath + ".bak");
    if (!existsSync(bak)) throw new ToolError("NO_CHECKPOINT", "Snapshot file is missing for this path.");
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, readFileSync(bak));
    return { path: relPath, reverted: true, deleted: false };
  }
  if (existsSync(abs) && statSync(abs).isFile()) {
    unlinkSync(abs);
    return { path: relPath, reverted: false, deleted: true };
  }
  return { path: relPath, reverted: false, deleted: false };
}

/**
 * Restore with a safety net: first snapshot the CURRENT state of the
 * checkpoint's files as a new manual "pre-restore" checkpoint, then restore.
 * Nothing is ever silently destroyed — the pre-restore state is recoverable.
 */
export function safeRestoreCheckpoint(
  repoRoot: string,
  id: string,
): { restored: string[]; deleted: string[]; preRestoreId: string; preRestoreLabel: string } {
  const m = readManifest(repoRoot, id); // validates id + existence first
  const preId = newCheckpointId();
  const preLabel = "pre-restore " + new Date().toISOString().slice(0, 19).replace("T", " ");
  snapshotFiles(repoRoot, preId, m.files.map((f) => f.path), { kind: "manual", label: preLabel });
  pruneManualCheckpoints(repoRoot, MANUAL_KEEP);
  const res = restoreCheckpoint(repoRoot, id);
  return { ...res, preRestoreId: preId, preRestoreLabel: preLabel };
}

/* ------------------------------------------------------------------ */
/* Unified diff generation (server-side, real diff of file contents)    */
/* ------------------------------------------------------------------ */

export interface UnifiedDiffOpts {
  context?: number;
  maxLines?: number;
}

/**
 * Real unified diff between two texts: common prefix/suffix trimmed, one
 * hunk with `context` surrounding lines, standard @@ header. Returns ""
 * when the texts are identical. Capped at maxLines (default 400); a
 * truncation marker is appended as a non-diff line.
 */
export function unifiedDiff(
  oldText: string,
  newText: string,
  relPath: string,
  opts: UnifiedDiffOpts = {},
): string {
  if (oldText === newText) return "";
  const a = oldText ? oldText.split("\n") : [];
  const b = newText ? newText.split("\n") : [];
  const ctx = Math.max(0, Math.min(10, opts.context ?? 3));
  let pre = 0;
  while (pre < a.length && pre < b.length && a[pre] === b[pre]) pre++;
  let suf = 0;
  while (suf < a.length - pre && suf < b.length - pre && a[a.length - 1 - suf] === b[b.length - 1 - suf]) suf++;
  const aCtxStart = Math.max(0, pre - ctx);
  const bCtxStart = Math.max(0, pre - ctx);
  const aCtxEnd = Math.min(a.length, a.length - suf + ctx);
  const bCtxEnd = Math.min(b.length, b.length - suf + ctx);
  const hdr = (start: number, count: number) => `${start + 1}${count === 1 ? "" : "," + count}`;
  const lines: string[] = [
    `--- a/${relPath}`,
    `+++ b/${relPath}`,
    `@@ -${hdr(aCtxStart, aCtxEnd - aCtxStart)} +${hdr(bCtxStart, bCtxEnd - bCtxStart)} @@`,
  ];
  const maxLines = opts.maxLines ?? 400;
  let emitted = 0;
  let truncated = false;
  const push = (l: string) => {
    if (emitted >= maxLines) { truncated = true; return; }
    lines.push(l);
    emitted++;
  };
  for (let i = aCtxStart; i < pre; i++) push(" " + a[i]);
  for (let i = pre; i < a.length - suf; i++) push("-" + a[i]);
  for (let i = pre; i < b.length - suf; i++) push("+" + b[i]);
  for (let i = a.length - suf; i < aCtxEnd; i++) push(" " + a[i]);
  if (truncated) lines.push(`... (diff truncated at ${maxLines} lines)`);
  return lines.join("\n");
}

export interface FileDiff {
  path: string;
  status: "added" | "removed" | "modified";
  diff: string;
  truncated: boolean;
  note?: string;
}

export interface CompareResult {
  a: CheckpointMeta;
  b: CheckpointMeta;
  diffs: FileDiff[];
  filesCompared: number;
  truncated: boolean;
}

/**
 * Real per-file diffs between two checkpoints (a → b). Unchanged files are
 * omitted. Capped: at most maxFiles files with diffs, maxLinesPerFile lines
 * each; oversized/binary files get a note instead of a diff.
 */
export function compareCheckpoints(
  repoRoot: string,
  idA: string,
  idB: string,
  opts: { maxFiles?: number; maxLinesPerFile?: number } = {},
): CompareResult {
  const ma = readManifest(repoRoot, idA);
  const mb = readManifest(repoRoot, idB);
  const maxFiles = opts.maxFiles ?? 80;
  const maxLinesPerFile = opts.maxLinesPerFile ?? 400;
  const paths = [...new Set([...ma.files.map((f) => f.path), ...mb.files.map((f) => f.path)])].sort();
  const inA = new Set(ma.files.map((f) => f.path));
  const inB = new Set(mb.files.map((f) => f.path));
  const diffs: FileDiff[] = [];
  let truncated = false;
  for (const p of paths) {
    if (diffs.length >= maxFiles) { truncated = true; break; }
    const wasInA = inA.has(p);
    const wasInB = inB.has(p);
    let ca: { existed: boolean; content: string | null; note?: string } = { existed: false, content: null };
    let cb: { existed: boolean; content: string | null; note?: string } = { existed: false, content: null };
    if (wasInA) {
      try { ca = readCheckpointFile(repoRoot, idA, p); }
      catch { ca = { existed: true, content: null, note: "unreadable in checkpoint" }; }
    }
    if (wasInB) {
      try { cb = readCheckpointFile(repoRoot, idB, p); }
      catch { cb = { existed: true, content: null, note: "unreadable in checkpoint" }; }
    }
    if (!wasInA || !wasInB) {
      // Added or removed between the checkpoints. A manifest entry marked
      // "did not exist" on the present side means no effective change.
      const present = !wasInA ? cb : ca;
      if (!present.existed) continue;
      const status = !wasInA ? "added" : "removed";
      const content = present.content;
      if (content === null) {
        diffs.push({ path: p, status, diff: "", truncated: false, note: present.note || "unreadable" });
      } else {
        const diff = unifiedDiff(!wasInA ? "" : content, !wasInA ? content : "", p, { maxLines: maxLinesPerFile });
        diffs.push({ path: p, status, diff, truncated: diff.includes("... (diff truncated") });
      }
      continue;
    }
    const ta = ca.existed ? ca.content : "";
    const tb = cb.existed ? cb.content : "";
    if (ta === null || tb === null) {
      diffs.push({ path: p, status: "modified", diff: "", truncated: false, note: ca.note || cb.note || "unreadable" });
      continue;
    }
    if (ta === tb) continue;
    const status = !ca.existed ? "added" : !cb.existed ? "removed" : "modified";
    const diff = unifiedDiff(ta, tb, p, { maxLines: maxLinesPerFile });
    diffs.push({ path: p, status, diff, truncated: diff.includes("... (diff truncated") });
  }
  return {
    a: metaOf(ma),
    b: metaOf(mb),
    diffs,
    filesCompared: paths.length,
    truncated,
  };
}
