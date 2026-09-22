import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { resolveInWorkspace } from "../tools/paths";
import { readProjectFile, writeProjectFile } from "../files/project-files";

export interface TurnSnapshot {
  ts: string;
  files: Record<string, string | null>;
}

const SNAPSHOT_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/;

/** Snapshot ids become file names; reject anything that could traverse directories. */
function assertValidSnapshotId(id: string): void {
  if (typeof id !== "string" || !SNAPSHOT_ID_PATTERN.test(id)) {
    throw new Error(`Invalid snapshot id: ${String(id).slice(0, 64)}`);
  }
}

export class SnapshotStore {
  private dir: string;

  constructor(root: string) {
    this.dir = join(root, ".agent", "snapshots");
  }

  ensure(): void {
    mkdirSync(this.dir, { recursive: true });
  }

  private path(id: string): string {
    assertValidSnapshotId(id);
    return join(this.dir, `${id}.json`);
  }

  private redoPath(id: string): string {
    assertValidSnapshotId(id);
    return join(this.dir, `${id}.redo.json`);
  }

  private read(path: string): TurnSnapshot[] {
    if (!existsSync(path)) return [];
    try {
      const data = JSON.parse(readFileSync(path, "utf8"));
      return Array.isArray(data) ? (data as TurnSnapshot[]) : [];
    } catch {
      return [];
    }
  }

  list(id: string): TurnSnapshot[] {
    return this.read(this.path(id));
  }

  push(id: string, turn: TurnSnapshot): void {
    const all = this.list(id);
    all.push(turn);
    this.ensure();
    writeFileSync(this.path(id), JSON.stringify(all, null, 2), "utf8");
  }

  pop(id: string): TurnSnapshot | undefined {
    const all = this.list(id);
    const turn = all.pop();
    this.ensure();
    writeFileSync(this.path(id), JSON.stringify(all, null, 2), "utf8");
    return turn;
  }

  listRedo(id: string): TurnSnapshot[] {
    return this.read(this.redoPath(id));
  }

  pushRedo(id: string, turn: TurnSnapshot): void {
    const all = this.listRedo(id);
    all.push(turn);
    this.ensure();
    writeFileSync(this.redoPath(id), JSON.stringify(all, null, 2), "utf8");
  }

  popRedo(id: string): TurnSnapshot | undefined {
    const all = this.listRedo(id);
    const turn = all.pop();
    this.ensure();
    writeFileSync(this.redoPath(id), JSON.stringify(all, null, 2), "utf8");
    return turn;
  }

  /** Drop all redo history for a session. New turns invalidate redo. */
  clearRedo(id: string): void {
    this.ensure();
    writeFileSync(this.redoPath(id), "[]", "utf8");
  }
}

/** Capture the current on-disk contents of the given files as a snapshot turn. */
export function captureCurrent(root: string, files: string[]): TurnSnapshot {
  const map: Record<string, string | null> = {};
  for (const file of files) {
    const content = readProjectFile(root, file);
    map[file] = content === undefined ? null : content;
  }
  return { ts: new Date().toISOString(), files: map };
}

export function restoreTurn(root: string, turn: TurnSnapshot): string[] {
  const restored: string[] = [];
  for (const [p, content] of Object.entries(turn.files)) {
    if (content === null) {
      const { full, ok } = resolveInWorkspace(root, p);
      if (ok && existsSync(full)) {
        try {
          rmSync(full, { force: true });
          restored.push(p);
        } catch {
          /* ignore */
        }
      }
    } else if (writeProjectFile(root, p, content)) {
      restored.push(p);
    }
  }
  return restored;
}
