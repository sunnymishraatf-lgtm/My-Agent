/**
 * NEUTRON collaboration — Phase 2: per-room shared file registry with Yjs
 * CRDT documents, debounced disk snapshots, and a version ring buffer.
 *
 * Pure logic + node builtins + yjs only (no `ws` here), so the whole module
 * is unit-testable. The WebSocket layer lives in collab-server.ts.
 *
 * Permission model (documented rule): any room member may create files and
 * edit file content; only the room OWNER may rename or delete files, rename
 * the room, delete the room, or restore old versions. The caller (collab
 * server) enforces this using the server-derived member role — the client is
 * never trusted for roles.
 *
 * Text only: shared editing supports UTF-8 text up to MAX_FILE_CHARS per
 * file. Binary files are rejected with an honest error.
 */
import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync, readdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import * as Y from "yjs";

/** Refuse shared editing past this many characters (honest limit). */
export const MAX_FILE_CHARS = 500_000;
/** Refuse a single Yjs update larger than this (DoS guard). */
export const MAX_UPDATE_BYTES = 1024 * 1024;
/** Trailing-edge delay before a dirty file is snapshotted to disk. */
export const SNAPSHOT_DEBOUNCE_MS = 5_000;
/** Minimum gap between automatic version entries (ring buffer). */
export const VERSION_THROTTLE_MS = 60_000;
/** Versions kept per file. */
export const MAX_VERSIONS = 20;
export const MAX_PATH_LEN = 200;

export interface CollabFileMeta {
  id: string;
  path: string;
  updatedAt: number;
  updatedBy: string;
  updatedByName: string;
}

export interface CollabVersion {
  ts: number;
  author: string;
  authorName: string;
}

export type FileOpError =
  | "INVALID_PATH"
  | "FILE_EXISTS"
  | "FILE_NOT_FOUND"
  | "FILE_TOO_LARGE"
  | "UPDATE_TOO_LARGE"
  | "VERSION_NOT_FOUND";

/**
 * Validate a user-supplied file path. Returns the normalized path or null.
 * Rules: relative, no `..` segments, no control chars, ≤ MAX_PATH_LEN,
 * no leading/trailing slashes, no empty segments, no backslashes.
 */
export function sanitizeCollabPath(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  let p = raw.trim().replace(/\\/g, "/");
  if (!p || p.length > MAX_PATH_LEN) return null;
  if (p.startsWith("/") || p.endsWith("/")) return null;
  if (/[\u0000-\u001F\u007F]/.test(p)) return null;
  const segs = p.split("/");
  for (const s of segs) {
    if (!s || s === "." || s === "..") return null;
    if (s.length > 120) return null;
  }
  // Collapse accidental double slashes.
  p = segs.join("/");
  return p;
}

/** Minimal text diff: common prefix/suffix → retain/delete/insert ops. */
export function diffTextOps(
  oldText: string,
  newText: string,
): Array<{ retain?: number; delete?: number; insert?: string }> {
  if (oldText === newText) return [];
  let prefix = 0;
  const maxPrefix = Math.min(oldText.length, newText.length);
  while (prefix < maxPrefix && oldText.charCodeAt(prefix) === newText.charCodeAt(prefix)) prefix++;
  let suffix = 0;
  const maxSuffix = Math.min(oldText.length - prefix, newText.length - prefix);
  while (
    suffix < maxSuffix &&
    oldText.charCodeAt(oldText.length - 1 - suffix) === newText.charCodeAt(newText.length - 1 - suffix)
  ) {
    suffix++;
  }
  const ops: Array<{ retain?: number; delete?: number; insert?: string }> = [];
  if (prefix > 0) ops.push({ retain: prefix });
  const delCount = oldText.length - prefix - suffix;
  if (delCount > 0) ops.push({ delete: delCount });
  const ins = newText.slice(prefix, newText.length - suffix);
  if (ins) ops.push({ insert: ins });
  return ops;
}

/** Apply diffTextOps to a Y.Text inside one transaction. */
export function applyOpsToYText(ytext: Y.Text, ops: Array<{ retain?: number; delete?: number; insert?: string }>): void {
  let index = 0;
  for (const op of ops) {
    if (op.retain) index += op.retain;
    if (op.delete) {
      ytext.delete(index, op.delete);
    }
    if (op.insert) {
      ytext.insert(index, op.insert);
      index += op.insert.length;
    }
  }
}

function randomFileId(): string {
  return `f_${randomBytes(8).toString("hex")}`;
}

interface LiveFile {
  meta: CollabFileMeta;
  doc: Y.Doc;
  ytext: Y.Text;
  dirty: boolean;
  oversized: boolean;
  lastVersionTs: number;
}

interface ManifestFile {
  version: 1;
  files: CollabFileMeta[];
}

export class CollabFileStore {
  private rooms = new Map<string, Map<string, LiveFile>>();
  private saveTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private now: () => number;
  /** Called after every snapshot attempt: (roomCode, fileId, ok). */
  onSnapshot: ((roomCode: string, fileId: string, ok: boolean) => void) | null = null;

  constructor(
    private dataRoot: string,
    now?: () => number,
  ) {
    this.now = now ?? Date.now;
  }

  private roomDir(roomCode: string): string {
    return join(this.dataRoot, ".agent", "collab", "files", roomCode);
  }

  private versionsDir(roomCode: string): string {
    return join(this.dataRoot, ".agent", "collab", "versions", roomCode);
  }

  private live(roomCode: string): Map<string, LiveFile> {
    let m = this.rooms.get(roomCode);
    if (!m) {
      m = new Map();
      this.rooms.set(roomCode, m);
    }
    return m;
  }

  /** Load the manifest (id → path registry) for a room from disk. */
  private loadManifest(roomCode: string): CollabFileMeta[] {
    const path = join(this.roomDir(roomCode), "manifest.json");
    if (!existsSync(path)) return [];
    try {
      const parsed = JSON.parse(readFileSync(path, "utf8")) as ManifestFile;
      if (!parsed || parsed.version !== 1 || !Array.isArray(parsed.files)) return [];
      return parsed.files.filter(
        (f) => f && typeof f.id === "string" && typeof f.path === "string" && sanitizeCollabPath(f.path) === f.path,
      );
    } catch {
      return []; // corrupt manifest — start fresh rather than crash
    }
  }

  private writeManifest(roomCode: string): void {
    const dir = this.roomDir(roomCode);
    mkdirSync(dir, { recursive: true });
    const files = [...this.live(roomCode).values()].map((l) => l.meta);
    // Include on-disk-only files already in the manifest so we never drop
    // entries for files not currently loaded into memory.
    const seen = new Set(files.map((f) => f.id));
    for (const m of this.loadManifest(roomCode)) {
      if (!seen.has(m.id)) files.push(m);
    }
    const snap: ManifestFile = { version: 1, files };
    writeFileSync(join(dir, "manifest.json"), JSON.stringify(snap), "utf8");
  }

  /** Get (or load from disk) the live Y.Doc for a file. */
  getFile(roomCode: string, fileId: string): LiveFile | undefined {
    const m = this.live(roomCode);
    let live = m.get(fileId);
    if (live) return live;
    const manifest = this.loadManifest(roomCode);
    const meta = manifest.find((f) => f.id === fileId);
    if (!meta) return undefined;
    const doc = new Y.Doc();
    const ybin = join(this.roomDir(roomCode), `${fileId}.ybin`);
    if (existsSync(ybin)) {
      try {
        Y.applyUpdate(doc, new Uint8Array(readFileSync(ybin)), "load");
      } catch {
        /* corrupt snapshot — start empty rather than crash */
      }
    }
    live = {
      meta: { ...meta },
      doc,
      ytext: doc.getText("content"),
      dirty: false,
      oversized: doc.getText("content").length > MAX_FILE_CHARS,
      lastVersionTs: this.latestVersionTs(roomCode, fileId),
    };
    m.set(fileId, live);
    return live;
  }

  listFiles(roomCode: string): CollabFileMeta[] {
    const live = this.live(roomCode);
    const out = new Map<string, CollabFileMeta>();
    for (const m of this.loadManifest(roomCode)) out.set(m.id, { ...m });
    for (const [id, l] of live) out.set(id, { ...l.meta });
    return [...out.values()].sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  }

  createFile(
    roomCode: string,
    rawPath: unknown,
    memberId: string,
    displayName: string,
  ): { meta: CollabFileMeta } | { error: FileOpError } {
    const path = sanitizeCollabPath(rawPath);
    if (!path) return { error: "INVALID_PATH" };
    if (this.listFiles(roomCode).some((f) => f.path === path)) return { error: "FILE_EXISTS" };
    const now = this.now();
    const meta: CollabFileMeta = {
      id: randomFileId(),
      path,
      updatedAt: now,
      updatedBy: memberId,
      updatedByName: displayName,
    };
    const doc = new Y.Doc();
    this.live(roomCode).set(meta.id, {
      meta,
      doc,
      ytext: doc.getText("content"),
      dirty: true,
      oversized: false,
      lastVersionTs: 0,
    });
    this.markDirty(roomCode, meta.id);
    return { meta: { ...meta } };
  }

  renameFile(
    roomCode: string,
    fileId: string,
    rawPath: unknown,
  ): { meta: CollabFileMeta } | { error: FileOpError } {
    const path = sanitizeCollabPath(rawPath);
    if (!path) return { error: "INVALID_PATH" };
    const live = this.getFile(roomCode, fileId);
    if (!live) return { error: "FILE_NOT_FOUND" };
    if (this.listFiles(roomCode).some((f) => f.path === path && f.id !== fileId)) return { error: "FILE_EXISTS" };
    live.meta.path = path;
    live.meta.updatedAt = this.now();
    live.dirty = true;
    this.markDirty(roomCode, fileId);
    return { meta: { ...live.meta } };
  }

  deleteFile(roomCode: string, fileId: string): boolean {
    const live = this.live(roomCode).get(fileId) ?? this.getFile(roomCode, fileId);
    if (!live && !this.loadManifest(roomCode).some((f) => f.id === fileId)) return false;
    this.live(roomCode).delete(fileId);
    try {
      rmSync(join(this.roomDir(roomCode), `${fileId}.ybin`), { force: true });
    } catch {
      /* ignore */
    }
    // Remove from manifest.
    try {
      const dir = this.roomDir(roomCode);
      const remaining = this.loadManifest(roomCode).filter((f) => f.id !== fileId);
      const liveFiles = [...this.live(roomCode).values()].map((l) => l.meta);
      const seen = new Set(liveFiles.map((f) => f.id));
      const merged = [...liveFiles];
      for (const m of remaining) if (!seen.has(m.id)) merged.push(m);
      mkdirSync(dir, { recursive: true });
      writeFileSync(join(dir, "manifest.json"), JSON.stringify({ version: 1, files: merged }), "utf8");
    } catch {
      /* ignore */
    }
    this.clearTimer(roomCode, fileId);
    return true;
  }

  /** Server's state vector for the sync handshake (step 1). */
  stateVector(roomCode: string, fileId: string): Uint8Array | undefined {
    const live = this.getFile(roomCode, fileId);
    return live ? Y.encodeStateVector(live.doc) : undefined;
  }

  /** Diff update bringing the client up to date (step 2 reply). */
  diffUpdate(roomCode: string, fileId: string, clientSv: Uint8Array): Uint8Array | undefined {
    const live = this.getFile(roomCode, fileId);
    if (!live) return undefined;
    return Y.encodeStateAsUpdate(live.doc, clientSv);
  }

  /**
   * Apply a client update (from sync step 2 or a live edit). Marks the file
   * dirty for snapshotting. Returns the update bytes for broadcast, or an
   * error. Oversized files stop accepting edits but keep serving reads.
   */
  applyClientUpdate(
    roomCode: string,
    fileId: string,
    update: Uint8Array,
    memberId: string,
    displayName: string,
  ): { update: Uint8Array } | { error: FileOpError } {
    if (update.length > MAX_UPDATE_BYTES) return { error: "UPDATE_TOO_LARGE" };
    const live = this.getFile(roomCode, fileId);
    if (!live) return { error: "FILE_NOT_FOUND" };
    if (live.oversized) return { error: "FILE_TOO_LARGE" };
    try {
      Y.applyUpdate(live.doc, update, `remote:${memberId}`);
    } catch {
      return { error: "UPDATE_TOO_LARGE" };
    }
    if (live.ytext.length > MAX_FILE_CHARS) {
      // Honest limit: keep existing content, refuse further edits.
      live.oversized = true;
      return { error: "FILE_TOO_LARGE" };
    }
    live.meta.updatedAt = this.now();
    live.meta.updatedBy = memberId;
    live.meta.updatedByName = displayName;
    live.dirty = true;
    this.markDirty(roomCode, fileId);
    return { update };
  }

  /** Current text of a file (for version previews). */
  fileText(roomCode: string, fileId: string): string | undefined {
    const live = this.getFile(roomCode, fileId);
    return live?.ytext.toString();
  }

  // ----- versions ------------------------------------------------------

  private versionIndexPath(roomCode: string, fileId: string): string {
    return join(this.versionsDir(roomCode), `${fileId}.json`);
  }

  private readVersionIndex(roomCode: string, fileId: string): CollabVersion[] {
    const p = this.versionIndexPath(roomCode, fileId);
    if (!existsSync(p)) return [];
    try {
      const arr = JSON.parse(readFileSync(p, "utf8")) as CollabVersion[];
      return Array.isArray(arr) ? arr.filter((v) => typeof v?.ts === "number") : [];
    } catch {
      return [];
    }
  }

  private writeVersionIndex(roomCode: string, fileId: string, versions: CollabVersion[]): void {
    mkdirSync(this.versionsDir(roomCode), { recursive: true });
    writeFileSync(this.versionIndexPath(roomCode, fileId), JSON.stringify(versions), "utf8");
  }

  private latestVersionTs(roomCode: string, fileId: string): number {
    const idx = this.readVersionIndex(roomCode, fileId);
    const last = idx.length ? idx[idx.length - 1] : undefined;
    return last ? last.ts : 0;
  }

  listVersions(roomCode: string, fileId: string): CollabVersion[] {
    if (!this.getFile(roomCode, fileId)) return [];
    return this.readVersionIndex(roomCode, fileId).slice(-MAX_VERSIONS);
  }

  /** Record a version entry (throttled). Called from snapshotNow. */
  private maybeRecordVersion(roomCode: string, fileId: string, author: string, authorName: string): void {
    const live = this.live(roomCode).get(fileId);
    const now = this.now();
    const lastTs = live ? live.lastVersionTs : this.latestVersionTs(roomCode, fileId);
    if (now - lastTs < VERSION_THROTTLE_MS) return;
    const doc = live?.doc;
    if (!doc) return;
    const update = Y.encodeStateAsUpdate(doc);
    const dir = this.versionsDir(roomCode);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, `${fileId}-${now}.ybin`), Buffer.from(update));
    const idx = this.readVersionIndex(roomCode, fileId);
    idx.push({ ts: now, author, authorName });
    // Ring buffer: keep the newest MAX_VERSIONS, delete the rest from disk.
    while (idx.length > MAX_VERSIONS) {
      const dropped = idx.shift()!;
      try {
        rmSync(join(dir, `${fileId}-${dropped.ts}.ybin`), { force: true });
      } catch {
        /* ignore */
      }
    }
    this.writeVersionIndex(roomCode, fileId, idx);
    if (live) live.lastVersionTs = now;
  }

  versionText(roomCode: string, fileId: string, ts: number): string | undefined {
    if (!this.getFile(roomCode, fileId)) return undefined;
    const p = join(this.versionsDir(roomCode), `${fileId}-${ts}.ybin`);
    if (!existsSync(p)) return undefined;
    try {
      const doc = new Y.Doc();
      Y.applyUpdate(doc, new Uint8Array(readFileSync(p)), "version-read");
      return doc.getText("content").toString();
    } catch {
      return undefined;
    }
  }

  /**
   * Restore a version by computing the text diff and applying it as a single
   * Yjs transaction — collaborators receive it as a normal update (never a
   * silent overwrite). Returns the update bytes for broadcast.
   */
  restoreVersion(
    roomCode: string,
    fileId: string,
    ts: number,
    memberId: string,
    displayName: string,
  ): { update: Uint8Array; text: string } | { error: FileOpError } {
    const live = this.getFile(roomCode, fileId);
    if (!live) return { error: "FILE_NOT_FOUND" };
    const oldText = this.versionText(roomCode, fileId, ts);
    if (oldText === undefined) return { error: "VERSION_NOT_FOUND" };
    const current = live.ytext.toString();
    const ops = diffTextOps(current, oldText);
    if (!ops.length) return { update: new Uint8Array(0), text: oldText };
    const before = Y.encodeStateVector(live.doc);
    live.doc.transact(() => {
      applyOpsToYText(live.ytext, ops);
    }, `restore:${memberId}`);
    const update = Y.encodeStateAsUpdate(live.doc, before);
    live.meta.updatedAt = this.now();
    live.meta.updatedBy = memberId;
    live.meta.updatedByName = displayName;
    live.dirty = true;
    this.markDirty(roomCode, fileId);
    return { update, text: oldText };
  }

  // ----- snapshots -----------------------------------------------------

  private timerKey(roomCode: string, fileId: string): string {
    return `${roomCode}\u0000${fileId}`;
  }

  private markDirty(roomCode: string, fileId: string): void {
    const key = this.timerKey(roomCode, fileId);
    if (this.saveTimers.has(key)) return;
    const timer = setTimeout(() => {
      this.saveTimers.delete(key);
      this.snapshotNow(roomCode, fileId);
    }, SNAPSHOT_DEBOUNCE_MS);
    const u = timer as unknown as { unref?: () => void };
    if (typeof u.unref === "function") u.unref();
    this.saveTimers.set(key, timer);
  }

  private clearTimer(roomCode: string, fileId: string): void {
    const key = this.timerKey(roomCode, fileId);
    const t = this.saveTimers.get(key);
    if (t) {
      clearTimeout(t);
      this.saveTimers.delete(key);
    }
  }

  /** Write the Yjs update + manifest to disk now. Reports via onSnapshot. */
  snapshotNow(roomCode: string, fileId?: string): void {
    const ids = fileId ? [fileId] : [...this.live(roomCode).keys()];
    for (const id of ids) {
      const live = this.live(roomCode).get(id);
      if (!live || !live.dirty) continue;
      let ok = true;
      try {
        const dir = this.roomDir(roomCode);
        mkdirSync(dir, { recursive: true });
        writeFileSync(join(dir, `${id}.ybin`), Buffer.from(Y.encodeStateAsUpdate(live.doc)));
        this.writeManifest(roomCode);
        this.maybeRecordVersion(roomCode, id, live.meta.updatedBy, live.meta.updatedByName);
        live.dirty = false;
      } catch {
        ok = false;
      }
      try {
        this.onSnapshot?.(roomCode, id, ok);
      } catch {
        /* callback must never break snapshotting */
      }
    }
  }

  /** Snapshot everything for a room and drop the in-memory docs (room empty). */
  releaseRoom(roomCode: string): void {
    this.snapshotNow(roomCode);
    for (const id of [...this.live(roomCode).keys()]) this.clearTimer(roomCode, id);
    this.rooms.delete(roomCode);
  }

  /** Delete all on-disk data for a room (room deleted). */
  deleteRoomData(roomCode: string): void {
    for (const id of [...this.live(roomCode).keys()]) this.clearTimer(roomCode, id);
    this.rooms.delete(roomCode);
    for (const dir of [this.roomDir(roomCode), this.versionsDir(roomCode)]) {
      try {
        rmSync(dir, { recursive: true, force: true });
      } catch {
        /* ignore */
      }
    }
  }

  /** Test helper: how many live docs are held. */
  liveDocCount(): number {
    let n = 0;
    for (const m of this.rooms.values()) n += m.size;
    return n;
  }
}
