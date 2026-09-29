/**
 * Checkpoints — before the IMPLEMENT phase, the agent snapshots every file it
 * is about to touch. The UI offers Restore on the final report, so working
 * code is never silently destroyed.
 */

import {
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { resolveSafePath, ToolError } from "./tools";

function checkpointDir(repoRoot: string, runId: string): string {
  return join(repoRoot, ".agent", "checkpoints", runId);
}

/** Snapshot the given relative paths (missing files are recorded as absent). */
export function snapshotFiles(repoRoot: string, runId: string, relPaths: string[]): { snapshotted: string[] } {
  const dir = checkpointDir(repoRoot, runId);
  mkdirSync(dir, { recursive: true });
  const manifest: Array<{ path: string; existed: boolean }> = [];
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
  writeFileSync(join(dir, "manifest.json"), JSON.stringify({ runId, at: new Date().toISOString(), files: manifest }, null, 2));
  return { snapshotted: manifest.filter((m) => m.existed).map((m) => m.path) };
}

export interface CheckpointFile { path: string; existed: boolean }

/** List what a checkpoint contains. */
export function listCheckpoint(repoRoot: string, runId: string): CheckpointFile[] {
  const manifest = join(checkpointDir(repoRoot, runId), "manifest.json");
  if (!existsSync(manifest)) throw new ToolError("NO_CHECKPOINT", "No checkpoint found for this run.");
  try {
    const parsed = JSON.parse(readFileSync(manifest, "utf8")) as { files?: CheckpointFile[] };
    return Array.isArray(parsed.files) ? parsed.files : [];
  } catch {
    throw new ToolError("NO_CHECKPOINT", "Checkpoint manifest is unreadable.");
  }
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
    rmSync(checkpointDir(repoRoot, runId), { recursive: true, force: true });
  } catch { /* best-effort */ }
}

export function checkpointExists(repoRoot: string, runId: string): boolean {
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
