/**
 * Phase 2 collaboration tests: Yjs CRDT sync, file store, sync protocol,
 * permissions, awareness relay, versions, rate limits — plus the pure
 * client helpers in ui-utils.js.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { mkdtempSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { WebSocket } from "ws";
import * as Y from "yjs";
import { RoomManager } from "../src/server/collab/room-manager";
import {
  CollabServer,
  encodeSyncFrame,
  decodeSyncFrame,
} from "../src/server/collab/collab-server";
import {
  CollabFileStore,
  sanitizeCollabPath,
  diffTextOps,
  applyOpsToYText,
  MAX_FILE_CHARS,
} from "../src/server/collab/file-store";
import ui from "../src/web/app/ui-utils.js";

// ---------------------------------------------------------------------------
// Pure client helpers
// ---------------------------------------------------------------------------

describe("b64encodeBytes / b64decodeBytes", () => {
  it("round-trips binary data", () => {
    const bytes = new Uint8Array([0, 1, 2, 250, 255, 13, 10]);
    const s = (ui as any).b64encodeBytes(bytes);
    const back = (ui as any).b64decodeBytes(s);
    expect(Array.from(back)).toEqual(Array.from(bytes));
  });
  it("rejects invalid input", () => {
    expect((ui as any).b64decodeBytes("")).toBe(null);
    expect((ui as any).b64decodeBytes(null)).toBe(null);
    expect((ui as any).b64decodeBytes("!!!not-base64!!!")).toBe(null);
  });
});

describe("sync framing interop (client <-> server)", () => {
  it("client encode -> server decode", () => {
    const payload = new Uint8Array([9, 8, 7, 6]);
    const frame = (ui as any).encodeSyncFrame(1, payload);
    const b64 = (ui as any).b64encodeBytes(frame);
    const raw = Buffer.from(b64, "base64");
    const decoded = decodeSyncFrame(new Uint8Array(raw));
    expect(decoded).not.toBe(null);
    expect(decoded!.type).toBe(1);
    expect(Array.from(decoded!.payload)).toEqual([9, 8, 7, 6]);
  });
  it("server encode -> client decode", () => {
    const payload = new Uint8Array([1, 2, 3]);
    const frame = encodeSyncFrame(0, payload);
    const b64 = Buffer.from(frame).toString("base64");
    const raw = (ui as any).b64decodeBytes(b64)!;
    const decoded = (ui as any).decodeSyncFrame(raw);
    expect(decoded.type).toBe(0);
    expect(Array.from(decoded.payload)).toEqual([1, 2, 3]);
  });
  it("rejects truncated frames", () => {
    expect((ui as any).decodeSyncFrame(new Uint8Array([1]))).toBe(null);
    expect(decodeSyncFrame(new Uint8Array([2, 99]))).toBe(null);
    expect((ui as any).decodeSyncFrame("nope")).toBe(null);
  });
});

describe("diffTextToOps", () => {
  function apply(oldText: string, ops: any[]): string {
    let out = oldText;
    let index = 0;
    // apply sequentially against a mutable buffer
    const buf = oldText.split("");
    for (const op of ops) {
      if (op.retain) index += op.retain;
      if (op.delete) buf.splice(index, op.delete);
      if (op.insert) {
        buf.splice(index, 0, ...op.insert.split(""));
        index += op.insert.length;
      }
    }
    out = buf.join("");
    return out;
  }
  it("computes insert ops", () => {
    const ops = (ui as any).diffTextToOps("hello world", "hello brave world");
    expect(ops).toEqual([{ retain: 6 }, { insert: "brave " }]);
    expect(apply("hello world", ops)).toBe("hello brave world");
  });
  it("computes delete ops", () => {
    const ops = (ui as any).diffTextToOps("hello brave world", "hello world");
    expect(apply("hello brave world", ops)).toBe("hello world");
  });
  it("computes replacements", () => {
    const ops = (ui as any).diffTextToOps("abc", "aXC");
    expect(apply("abc", ops)).toBe("aXC");
  });
  it("handles empty and identical inputs", () => {
    expect((ui as any).diffTextToOps("", "")).toEqual([]);
    expect((ui as any).diffTextToOps("same", "same")).toEqual([]);
    const ops = (ui as any).diffTextToOps("", "new");
    expect(apply("", ops)).toBe("new");
  });
});

describe("indexToLineCol", () => {
  it("maps indexes to 1-based line/col", () => {
    const f = (ui as any).indexToLineCol;
    expect(f("a\nbc\ndef", 0)).toEqual({ line: 1, col: 1 });
    expect(f("a\nbc\ndef", 2)).toEqual({ line: 2, col: 1 });
    expect(f("a\nbc\ndef", 4)).toEqual({ line: 2, col: 3 }); // at the newline itself
    expect(f("a\nbc\ndef", 5)).toEqual({ line: 3, col: 1 });
    expect(f("a\nbc\ndef", 7)).toEqual({ line: 3, col: 3 });
    expect(f("", 99)).toEqual({ line: 1, col: 1 });
  });
});

describe("sanitizeCollabPath (client)", () => {
  const f = (u: unknown) => (ui as any).sanitizeCollabPath(u);
  it("accepts relative paths", () => {
    expect(f("docs/notes.md")).toBe("docs/notes.md");
    expect(f("a.txt")).toBe("a.txt");
  });
  it("rejects traversal, absolute, and junk", () => {
    expect(f("../x")).toBe(null);
    expect(f("a/../../b")).toBe(null);
    expect(f("/abs")).toBe(null);
    expect(f("a/")).toBe(null);
    expect(f("")).toBe(null);
    expect(f("a//b")).toBe(null);
    expect(f("a\x00b")).toBe(null);
    expect(f(null)).toBe(null);
  });
});

describe("pickPresenceColor", () => {
  it("is deterministic and a valid hex color", () => {
    const c1 = (ui as any).pickPresenceColor("m_abc123");
    const c2 = (ui as any).pickPresenceColor("m_abc123");
    expect(c1).toBe(c2);
    expect(/^#[0-9a-fA-F]{6}$/.test(c1)).toBe(true);
    expect((ui as any).pickPresenceColor("m_xyz")).not.toBe(c1);
  });
});

describe("presence staleness (isPresenceStale / pruneStalePresence)", () => {
  const NOW = 1_000_000;
  it("marks entries older than 10s stale by default", () => {
    const uiAny = ui as any;
    expect(uiAny.PRESENCE_STALE_MS).toBe(10_000);
    expect(uiAny.isPresenceStale(NOW - 5_000, NOW)).toBe(false);
    expect(uiAny.isPresenceStale(NOW - 10_001, NOW)).toBe(true);
    expect(uiAny.isPresenceStale(NOW, NOW)).toBe(false);
  });
  it("treats missing/invalid timestamps as stale", () => {
    const f = (ui as any).isPresenceStale;
    expect(f(undefined, NOW)).toBe(true);
    expect(f(null, NOW)).toBe(true);
    expect(f("nope", NOW)).toBe(true);
    expect(f(NaN, NOW)).toBe(true);
  });
  it("honors an explicit maxAgeMs", () => {
    const f = (ui as any).isPresenceStale;
    expect(f(NOW - 5_000, NOW, 60_000)).toBe(false);
    expect(f(NOW - 5_000, NOW, 1_000)).toBe(true);
  });
  it("pruneStalePresence drops stale members and keeps the rest", () => {
    const f = (ui as any).pruneStalePresence;
    const map = {
      a: { name: "A", ts: NOW - 1_000 },
      b: { name: "B", ts: NOW - 60_000 },
      c: { name: "C" }, // no ts -> stale
    };
    const out = f(map, NOW);
    expect(Object.keys(out).sort()).toEqual(["a"]);
    expect(out.a.name).toBe("A");
    // Original is untouched (pure).
    expect(Object.keys(map).sort()).toEqual(["a", "b", "c"]);
  });
  it("pruneStalePresence handles null/invalid input", () => {
    const f = (ui as any).pruneStalePresence;
    expect(f(null, NOW)).toEqual({});
    expect(f(undefined, NOW)).toEqual({});
    expect(f("x", NOW)).toEqual({});
  });
});

describe("buildFileTree", () => {
  it("nests paths and sorts dirs first", () => {
    const tree = (ui as any).buildFileTree([
      { id: "1", path: "b/a.txt" },
      { id: "2", path: "a.txt" },
      { id: "3", path: "b/c.txt" },
    ]);
    expect(tree.map((n: any) => n.name)).toEqual(["b", "a.txt"]);
    expect(tree[0].dir).toBe(true);
    expect(tree[0].children.map((n: any) => n.name)).toEqual(["a.txt", "c.txt"]);
  });
});

// ---------------------------------------------------------------------------
// Yjs convergence (CRDT correctness)
// ---------------------------------------------------------------------------

describe("Yjs convergence", () => {
  it("concurrent inserts at different positions converge", () => {
    const d1 = new Y.Doc();
    const d2 = new Y.Doc();
    d1.getText("content").insert(0, "hello");
    // Sync d1 -> d2
    Y.applyUpdate(d2, Y.encodeStateAsUpdate(d1, Y.encodeStateVector(d2)));
    // Concurrent edits on both
    d1.getText("content").insert(0, "A:");
    d2.getText("content").insert(5, ":B");
    // Exchange updates both ways
    const u1 = Y.encodeStateAsUpdate(d1, Y.encodeStateVector(d2));
    const u2 = Y.encodeStateAsUpdate(d2, Y.encodeStateVector(d1));
    Y.applyUpdate(d2, u1);
    Y.applyUpdate(d1, u2);
    const t1 = d1.getText("content").toString();
    const t2 = d2.getText("content").toString();
    expect(t1).toBe(t2);
    expect(t1).toContain("A:");
    expect(t1).toContain(":B");
    expect(t1).toContain("hello");
  });
  it("concurrent insert and delete converge without resurrection", () => {
    const d1 = new Y.Doc();
    const d2 = new Y.Doc();
    d1.getText("content").insert(0, "abcdef");
    Y.applyUpdate(d2, Y.encodeStateAsUpdate(d1));
    d1.getText("content").delete(0, 3); // delete "abc"
    d2.getText("content").insert(6, "XYZ"); // append
    Y.applyUpdate(d2, Y.encodeStateAsUpdate(d1, Y.encodeStateVector(d2)));
    Y.applyUpdate(d1, Y.encodeStateAsUpdate(d2, Y.encodeStateVector(d1)));
    expect(d1.getText("content").toString()).toBe(d2.getText("content").toString());
    expect(d1.getText("content").toString()).toBe("defXYZ");
  });
  it("server diffTextOps/applyOpsToYText round-trips through Y.Text", () => {
    const doc = new Y.Doc();
    const yt = doc.getText("content");
    yt.insert(0, "hello world");
    const ops = diffTextOps("hello world", "hello brave new world");
    doc.transact(() => applyOpsToYText(yt, ops));
    expect(yt.toString()).toBe("hello brave new world");
  });
});

// ---------------------------------------------------------------------------
// CollabFileStore
// ---------------------------------------------------------------------------

function newStore(now?: () => number) {
  const dir = mkdtempSync(join(tmpdir(), "neutron-collab-fs-"));
  return { store: new CollabFileStore(dir, now), dir };
}

describe("sanitizeCollabPath (server)", () => {
  it("mirrors the client rules", () => {
    expect(sanitizeCollabPath("docs/notes.md")).toBe("docs/notes.md");
    expect(sanitizeCollabPath("../evil")).toBe(null);
    expect(sanitizeCollabPath("/abs")).toBe(null);
    expect(sanitizeCollabPath("a/")).toBe(null);
    expect(sanitizeCollabPath("")).toBe(null);
  });
});

describe("CollabFileStore file ops", () => {
  it("creates, lists, renames, deletes", () => {
    const { store } = newStore();
    const room = "NEUTRON-AAAAAA";
    const c = store.createFile(room, "docs/notes.md", "m1", "Sunny");
    expect("meta" in c).toBe(true);
    const meta = (c as any).meta;
    expect(store.listFiles(room).map((f) => f.path)).toEqual(["docs/notes.md"]);
    const dup = store.createFile(room, "docs/notes.md", "m1", "Sunny");
    expect(dup).toEqual({ error: "FILE_EXISTS" });
    const bad = store.createFile(room, "../x", "m1", "Sunny");
    expect(bad).toEqual({ error: "INVALID_PATH" });
    const r = store.renameFile(room, meta.id, "docs/renamed.md");
    expect((r as any).meta.path).toBe("docs/renamed.md");
    expect(store.deleteFile(room, meta.id)).toBe(true);
    expect(store.listFiles(room)).toEqual([]);
    expect(store.deleteFile(room, meta.id)).toBe(false);
  });
  it("applies client updates and tracks metadata", () => {
    const { store } = newStore();
    const room = "NEUTRON-BBBBBB";
    const { meta } = store.createFile(room, "a.txt", "m1", "Sunny") as any;
    const d = new Y.Doc();
    d.getText("content").insert(0, "hi");
    const res = store.applyClientUpdate(room, meta.id, Y.encodeStateAsUpdate(d), "m1", "Sunny");
    expect("update" in res).toBe(true);
    expect(store.fileText(room, meta.id)).toBe("hi");
    const listed = store.listFiles(room)[0]!;
    expect(listed.updatedByName).toBe("Sunny");
  });
  it("rejects oversized updates", () => {
    const { store } = newStore();
    const room = "NEUTRON-CCCCCC";
    const { meta } = store.createFile(room, "a.txt", "m1", "Sunny") as any;
    const res = store.applyClientUpdate(room, meta.id, new Uint8Array(2 * 1024 * 1024), "m1", "Sunny");
    expect(res).toEqual({ error: "UPDATE_TOO_LARGE" });
  });
  it("stops accepting edits past the text cap but keeps content", () => {
    const { store } = newStore();
    const room = "NEUTRON-DDDDDD";
    const { meta } = store.createFile(room, "big.txt", "m1", "Sunny") as any;
    const d = new Y.Doc();
    d.getText("content").insert(0, "x".repeat(MAX_FILE_CHARS + 1000));
    const res = store.applyClientUpdate(room, meta.id, Y.encodeStateAsUpdate(d), "m1", "Sunny");
    expect(res).toEqual({ error: "FILE_TOO_LARGE" });
    // Content is preserved; further edits refused; reads still work.
    expect(store.fileText(room, meta.id)!.length).toBe(MAX_FILE_CHARS + 1000);
    const d2 = new Y.Doc();
    d2.getText("content").insert(0, "more");
    expect(store.applyClientUpdate(room, meta.id, Y.encodeStateAsUpdate(d2), "m1", "Sunny")).toEqual({
      error: "FILE_TOO_LARGE",
    });
  });
  it("isOversized reflects the open-handshake gate", () => {
    const { store } = newStore();
    const room = "NEUTRON-EEEEEE";
    const { meta } = store.createFile(room, "ok.txt", "m1", "Sunny") as any;
    expect(store.isOversized(room, meta.id)).toBe(false);
    expect(store.isOversized(room, "no-such-file")).toBe(false);
    const d = new Y.Doc();
    d.getText("content").insert(0, "x".repeat(MAX_FILE_CHARS + 1));
    store.applyClientUpdate(room, meta.id, Y.encodeStateAsUpdate(d), "m1", "Sunny");
    expect(store.isOversized(room, meta.id)).toBe(true);
  });
});

describe("CollabFileStore snapshots", () => {
  it("round-trips through disk: encode -> write -> read -> decode", () => {
    let t = 1_000_000;
    const { store, dir } = newStore(() => t);
    const room = "NEUTRON-EEEEEE";
    const { meta } = store.createFile(room, "notes.md", "m1", "Sunny") as any;
    const d = new Y.Doc();
    d.getText("content").insert(0, "# hello\nworld");
    store.applyClientUpdate(room, meta.id, Y.encodeStateAsUpdate(d), "m1", "Sunny");
    let ack: any = null;
    store.onSnapshot = (_r, f, ok) => {
      ack = { f, ok };
    };
    store.snapshotNow(room, meta.id);
    expect(ack).toEqual({ f: meta.id, ok: true });
    expect(existsSync(join(dir, ".agent", "collab", "files", room, `${meta.id}.ybin`))).toBe(true);
    // A fresh store loads the same text from disk.
    const store2 = new CollabFileStore(dir, () => t);
    expect(store2.fileText(room, meta.id)).toBe("# hello\nworld");
    expect(store2.listFiles(room).map((f) => f.path)).toEqual(["notes.md"]);
  });
  it("releaseRoom snapshots and drops memory", () => {
    const { store } = newStore();
    const room = "NEUTRON-FFFFFF";
    const { meta } = store.createFile(room, "a.txt", "m1", "Sunny") as any;
    const d = new Y.Doc();
    d.getText("content").insert(0, "data");
    store.applyClientUpdate(room, meta.id, Y.encodeStateAsUpdate(d), "m1", "Sunny");
    expect(store.liveDocCount()).toBe(1);
    store.releaseRoom(room);
    expect(store.liveDocCount()).toBe(0);
    expect(store.fileText(room, meta.id)).toBe("data"); // reloaded from disk
  });
});

describe("CollabFileStore versions", () => {
  it("records throttled versions, caps the ring, restores as an update", () => {
    let t = 1_000_000;
    const { store } = newStore(() => t);
    const room = "NEUTRON-GGGGGG";
    const { meta } = store.createFile(room, "v.txt", "m1", "Sunny") as any;
    const setText = (text: string) => {
      const cur = store.fileText(room, meta.id)!;
      const ops = diffTextOps(cur, text);
      const live = (store as any).getFile(room, meta.id);
      live.doc.transact(() => applyOpsToYText(live.ytext, ops));
      live.dirty = true;
    };
    setText("version one");
    store.snapshotNow(room, meta.id); // t=1_000_000 -> records (throttle window passed)
    t += 61_000;
    setText("version two");
    store.snapshotNow(room, meta.id); // records
    t += 10_000;
    setText("version two+");
    store.snapshotNow(room, meta.id); // throttled: no new version
    const versions = store.listVersions(room, meta.id);
    expect(versions).toHaveLength(2);
    expect(versions[1]!.authorName).toBe("Sunny");
    // Ring buffer cap: push many versions, only MAX_VERSIONS kept.
    for (let i = 0; i < 30; i++) {
      t += 61_000;
      setText("v" + i);
      store.snapshotNow(room, meta.id);
    }
    expect(store.listVersions(room, meta.id)).toHaveLength(20);
    // Restore the oldest kept version as a Yjs update.
    const oldest = store.listVersions(room, meta.id)[0]!;
    const oldText = store.versionText(room, meta.id, oldest.ts)!;
    const before = store.fileText(room, meta.id)!;
    expect(oldText).not.toBe(before);
    // The peer shares document history (as a real collaborator would after
    // syncing); the restore update then merges cleanly.
    const liveDoc = (store as any).getFile(room, meta.id).doc as Y.Doc;
    const peer = new Y.Doc();
    Y.applyUpdate(peer, Y.encodeStateAsUpdate(liveDoc));
    expect(peer.getText("content").toString()).toBe(before);
    const res = store.restoreVersion(room, meta.id, oldest.ts, "m1", "Sunny") as any;
    expect(store.fileText(room, meta.id)).toBe(oldText);
    // The returned update merges into the converged peer.
    Y.applyUpdate(peer, res.update);
    expect(peer.getText("content").toString()).toBe(oldText);
    // Unknown version -> honest error.
    expect(store.restoreVersion(room, meta.id, 12345, "m1", "Sunny")).toEqual({ error: "VERSION_NOT_FOUND" });
  });
});

// ---------------------------------------------------------------------------
// CollabServer over a real WebSocket
// ---------------------------------------------------------------------------

class TestClient {
  ws: WebSocket;
  private queue: any[] = [];
  private waiters: Array<(m: any) => void> = [];
  constructor(url: string) {
    this.ws = new WebSocket(url);
    this.ws.on("message", (data) => {
      const m = JSON.parse(String(data));
      const w = this.waiters.shift();
      if (w) w(m);
      else this.queue.push(m);
    });
  }
  async open(): Promise<void> {
    if (this.ws.readyState === WebSocket.OPEN) return;
    await new Promise<void>((res, rej) => {
      this.ws.once("open", () => res());
      this.ws.once("error", (e) => rej(e));
    });
  }
  send(obj: unknown): void {
    this.ws.send(JSON.stringify(obj));
  }
  next(timeoutMs = 4000): Promise<any> {
    const queued = this.queue.shift();
    if (queued !== undefined) return Promise.resolve(queued);
    return new Promise((res, rej) => {
      // Waiters are removed on timeout so a later message is never eaten by
      // a stale waiter (the message handler shifts the oldest waiter).
      const w = (m: any) => {
        clearTimeout(timer);
        const i = this.waiters.indexOf(w);
        if (i >= 0) this.waiters.splice(i, 1);
        res(m);
      };
      const timer = setTimeout(() => {
        const i = this.waiters.indexOf(w);
        if (i >= 0) this.waiters.splice(i, 1);
        rej(new Error("timed out waiting for server message"));
      }, timeoutMs);
      this.waiters.push(w);
    });
  }
  /** Next message matching pred; non-matching messages are dropped. */
  async nextMatch(pred: (m: any) => boolean, timeoutMs = 4000): Promise<any> {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      const left = deadline - Date.now();
      if (left <= 0) throw new Error("timed out waiting for matching message");
      const m = await this.next(Math.min(left, 1000)).catch(() => null);
      if (m && pred(m)) return m;
    }
  }
  close(): void {
    try {
      this.ws.close();
    } catch {
      /* ignore */
    }
  }
}

/** Minimal y-websocket-style peer for end-to-end sync tests. */
class YjsPeer {
  doc = new Y.Doc();
  constructor(private send: (kind: "step1" | "step2" | "update", data: string) => void) {
    this.doc.on("update", (update: Uint8Array, origin: unknown) => {
      if (origin === "local") {
        this.send("update", Buffer.from(encodeSyncFrame(2, update)).toString("base64"));
      }
    });
  }
  handle(msg: any): void {
    const raw = Buffer.from(msg.data, "base64");
    const frame = decodeSyncFrame(new Uint8Array(raw))!;
    if (msg.kind === "step1" && frame.type === 0) {
      const diff = Y.encodeStateAsUpdate(this.doc, frame.payload);
      this.send("step2", Buffer.from(encodeSyncFrame(1, diff)).toString("base64"));
      const sv = Y.encodeStateVector(this.doc);
      this.send("step1", Buffer.from(encodeSyncFrame(0, sv)).toString("base64"));
    } else if ((msg.kind === "step2" && frame.type === 1) || (msg.kind === "update" && frame.type === 2)) {
      Y.applyUpdate(this.doc, frame.payload, "sync");
    }
  }
  get text(): string {
    return this.doc.getText("content").toString();
  }
  edit(insertText: string): void {
    this.doc.transact(() => {
      this.doc.getText("content").insert(this.text.length, insertText);
    }, "local");
  }
}

let server: Server;
let collab: CollabServer;
let mgr: RoomManager;
let url: string;
let t: number;
let dataRoot: string;
const clients: TestClient[] = [];

beforeEach(async () => {
  t = 1_000_000;
  dataRoot = mkdtempSync(join(tmpdir(), "neutron-collab-p2-"));
  mgr = new RoomManager(mkdtempSync(join(tmpdir(), "neutron-collab-mgr-")), () => t);
  collab = new CollabServer({ manager: mgr, dataRoot, now: () => t, heartbeatMs: 60_000, sweepMs: 60_000 });
  server = createServer();
  collab.attach(server);
  await new Promise<void>((res) => server.listen(0, "127.0.0.1", () => res()));
  const port = (server.address() as AddressInfo).port;
  url = `ws://127.0.0.1:${port}/collab`;
});

afterEach(async () => {
  for (const c of clients.splice(0)) c.close();
  collab.close();
  await new Promise<void>((res) => server.close(() => res()));
});

async function connect(): Promise<TestClient> {
  const c = new TestClient(url);
  clients.push(c);
  await c.open();
  return c;
}

async function joinRoom(c: TestClient, code: string, name: string, ownerToken?: string): Promise<any> {
  c.send({ type: "ROOM_JOIN", roomId: code, displayName: name, ...(ownerToken ? { ownerToken } : {}) });
  const joined = await c.nextMatch((m) => m.type === "JOINED" || m.type === "ERROR");
  expect(joined.type).toBe("JOINED");
  return joined;
}

describe("file permissions", () => {
  it("member cannot delete or rename files; owner can", async () => {
    const { room, ownerToken } = mgr.createRoom("Team");
    const owner = await connect();
    await joinRoom(owner, room.id, "Sunny", ownerToken);
    const member = await connect();
    await joinRoom(member, room.id, "Rahul");
    await owner.nextMatch((m) => m.type === "MEMBERS"); // drain
    // Member creates a file (allowed).
    member.send({ type: "FILE_CREATE", path: "notes.md" });
    const created = await member.nextMatch((m) => m.type === "FILE_EVENT");
    expect(created.event).toBe("created");
    const fileId = created.file.id;
    // Member cannot delete.
    member.send({ type: "FILE_DELETE", fileId });
    expect(await member.nextMatch((m) => m.type === "ERROR")).toMatchObject({ code: "NOT_OWNER" });
    // Member cannot rename.
    member.send({ type: "FILE_RENAME", fileId, newPath: "renamed.md" });
    expect(await member.nextMatch((m) => m.type === "ERROR")).toMatchObject({ code: "NOT_OWNER" });
    // Owner can delete.
    owner.send({ type: "FILE_DELETE", fileId });
    const del = await owner.nextMatch((m) => m.type === "FILE_EVENT" && m.event === "deleted");
    expect(del.fileId).toBe(fileId);
  });
  it("rejects invalid paths and duplicates", async () => {
    const { room } = mgr.createRoom("Team");
    const a = await connect();
    await joinRoom(a, room.id, "Sunny");
    a.send({ type: "FILE_CREATE", path: "../evil" });
    expect(await a.nextMatch((m) => m.type === "ERROR")).toMatchObject({ code: "INVALID_PATH" });
    a.send({ type: "FILE_CREATE", path: "a.txt" });
    await a.nextMatch((m) => m.type === "FILE_EVENT");
    a.send({ type: "FILE_CREATE", path: "a.txt" });
    expect(await a.nextMatch((m) => m.type === "ERROR")).toMatchObject({ code: "FILE_EXISTS" });
  });
});

describe("room rename/delete over WS", () => {
  it("member gets NOT_OWNER; owner renames and deletes", async () => {
    const { room, ownerToken } = mgr.createRoom("Team");
    const owner = await connect();
    await joinRoom(owner, room.id, "Sunny", ownerToken);
    const member = await connect();
    await joinRoom(member, room.id, "Rahul");
    await owner.nextMatch((m) => m.type === "MEMBERS"); // drain
    member.send({ type: "ROOM_RENAME", name: "Hacked" });
    expect(await member.nextMatch((m) => m.type === "ERROR")).toMatchObject({ code: "NOT_OWNER" });
    member.send({ type: "ROOM_DELETE" });
    expect(await member.nextMatch((m) => m.type === "ERROR")).toMatchObject({ code: "NOT_OWNER" });
    owner.send({ type: "ROOM_RENAME", name: "Renamed" });
    const renamed = await member.nextMatch((m) => m.type === "ROOM_RENAMED");
    expect(renamed.name).toBe("Renamed");
    expect(mgr.getRoom(room.id)!.name).toBe("Renamed");
    owner.send({ type: "ROOM_DELETE" });
    expect(await member.nextMatch((m) => m.type === "ROOM_DELETED")).toBeTruthy();
    expect(mgr.getRoom(room.id)).toBe(undefined);
    // Deleted room: members are dropped.
    member.send({ type: "CHAT_MESSAGE", text: "hello?" });
    expect(await member.nextMatch((m) => m.type === "ERROR")).toMatchObject({ code: "NOT_JOINED" });
  });
});

describe("Yjs sync end-to-end", () => {
  it("two peers converge through the server (no last-write-wins)", async () => {
    const { room, ownerToken } = mgr.createRoom("Team");
    const a = await connect();
    await joinRoom(a, room.id, "Sunny", ownerToken);
    const b = await connect();
    await joinRoom(b, room.id, "Rahul");
    await a.nextMatch((m) => m.type === "MEMBERS"); // drain
    // Owner creates a file.
    a.send({ type: "FILE_CREATE", path: "shared.txt" });
    const created = await a.nextMatch((m) => m.type === "FILE_EVENT" && m.event === "created");
    const fileId = created.file.id;
    await b.nextMatch((m) => m.type === "FILE_EVENT" && m.event === "created");

    const peerA = new YjsPeer((kind, data) => a.send({ type: "YJS_SYNC", fileId, kind, data }));
    const peerB = new YjsPeer((kind, data) => b.send({ type: "YJS_SYNC", fileId, kind, data }));

    // A opens: handshake.
    a.send({ type: "FILE_OPEN", fileId });
    peerA.handle(await a.nextMatch((m) => m.type === "YJS_SYNC" && m.kind === "step1"));
    // A's step2 reply is applied server-side (broadcast to nobody yet); A's
    // step1 gets a step2 answer.
    peerA.handle(await a.nextMatch((m) => m.type === "YJS_SYNC" && m.kind === "step2"));

    // B opens: handshake; B should receive A's later edits.
    b.send({ type: "FILE_OPEN", fileId });
    peerB.handle(await b.nextMatch((m) => m.type === "YJS_SYNC" && m.kind === "step1"));
    peerB.handle(await b.nextMatch((m) => m.type === "YJS_SYNC" && m.kind === "step2"));

    // Drain stale handshake broadcasts (each side's step2 reply is relayed
    // to the other opener) so the edit phase below is deterministic.
    for (const [c, peer] of [[a, peerA], [b, peerB]] as const) {
      for (;;) {
        const m = await c.nextMatch((m) => m.type === "YJS_SYNC", 250).catch(() => null);
        if (!m) break;
        peer.handle(m);
      }
    }

    // Concurrent edits: A types at the start, B types at the end.
    peerA.edit("AAA-");
    const updForB = await b.nextMatch((m) => m.type === "YJS_SYNC" && m.kind === "update");
    peerB.handle(updForB);
    peerB.edit("-BBB");
    const updForA = await a.nextMatch((m) => m.type === "YJS_SYNC" && m.kind === "update");
    peerA.handle(updForA);

    expect(peerA.text).toBe(peerB.text);
    expect(peerA.text).toContain("AAA-");
    expect(peerA.text).toContain("-BBB");
    // Server holds the converged document too.
    const store = (collab as any).files as CollabFileStore;
    expect(store.fileText(room.id, fileId)).toBe(peerA.text);
  });
  it("FILE_SNAPSHOT_REQ reports honest save state", async () => {
    const { room, ownerToken } = mgr.createRoom("Team");
    const a = await connect();
    await joinRoom(a, room.id, "Sunny", ownerToken);
    a.send({ type: "FILE_CREATE", path: "s.txt" });
    const created = await a.nextMatch((m) => m.type === "FILE_EVENT" && m.event === "created");
    a.send({ type: "FILE_SNAPSHOT_REQ", fileId: created.file.id });
    const snap = await a.nextMatch((m) => m.type === "FILE_SNAPSHOT");
    expect(snap).toMatchObject({ fileId: created.file.id, ok: true });
  });
});

describe("awareness relay", () => {
  it("relays cursor presence to other openers, never to the sender", async () => {
    const { room, ownerToken } = mgr.createRoom("Team");
    const a = await connect();
    const joinedA = await joinRoom(a, room.id, "Sunny", ownerToken);
    const b = await connect();
    await joinRoom(b, room.id, "Rahul");
    await a.nextMatch((m) => m.type === "MEMBERS"); // drain
    a.send({ type: "FILE_CREATE", path: "a.txt" });
    const created = await a.nextMatch((m) => m.type === "FILE_EVENT" && m.event === "created");
    const fileId = created.file.id;
    await b.nextMatch((m) => m.type === "FILE_EVENT" && m.event === "created");
    a.send({ type: "FILE_OPEN", fileId });
    await a.nextMatch((m) => m.type === "YJS_SYNC");
    b.send({ type: "FILE_OPEN", fileId });
    await b.nextMatch((m) => m.type === "YJS_SYNC");
    a.send({
      type: "AWARENESS_UPDATE",
      fileId,
      cursor: { index: 5, line: 2, col: 3 },
      selection: null,
      color: "#CC8066",
    });
    const aw = await b.nextMatch((m) => m.type === "AWARENESS");
    expect(aw.memberId).toBe(joinedA.you.id);
    expect(aw.displayName).toBe("Sunny");
    expect(aw.cursor).toEqual({ index: 5, line: 2, col: 3 });
    expect(aw.color).toBe("#CC8066");
    // Sender gets nothing.
    const none = await a.nextMatch((m) => m.type === "AWARENESS", 300).catch(() => null);
    expect(none).toBe(null);
  });
  it("drops malformed awareness silently", async () => {
    const { room } = mgr.createRoom("Team");
    const a = await connect();
    await joinRoom(a, room.id, "Sunny");
    a.send({ type: "AWARENESS_UPDATE", fileId: "f_zzzz", cursor: { index: -1 }, color: "red" });
    const none = await a.nextMatch((m) => m.type === "AWARENESS" || m.type === "ERROR", 300).catch(() => null);
    expect(none).toBe(null);
  });
});

describe("yjs rate limiting", () => {
  it("caps sync messages at 30/s per connection", async () => {
    const { room, ownerToken } = mgr.createRoom("Team");
    const a = await connect();
    await joinRoom(a, room.id, "Sunny", ownerToken);
    a.send({ type: "FILE_CREATE", path: "r.txt" });
    const created = await a.nextMatch((m) => m.type === "FILE_EVENT" && m.event === "created");
    const fileId = created.file.id;
    a.send({ type: "FILE_OPEN", fileId });
    await a.nextMatch((m) => m.type === "YJS_SYNC"); // step1
    // Burn through the 30-token bucket with tiny updates (clock is frozen).
    const peer = new Y.Doc();
    for (let i = 0; i < 35; i++) {
      const upd = Y.encodeStateAsUpdate(peer);
      a.send({
        type: "YJS_SYNC",
        fileId,
        kind: "update",
        data: Buffer.from(encodeSyncFrame(2, upd)).toString("base64"),
      });
    }
    const limited = await a.nextMatch((m) => m.type === "ERROR" && m.code === "RATE_LIMITED", 5000);
    expect(limited).toBeTruthy();
  });
});

describe("version restore over WS", () => {
  it("owner restores; member is refused", async () => {
    const { room, ownerToken } = mgr.createRoom("Team");
    const a = await connect();
    const joinedA = await joinRoom(a, room.id, "Sunny", ownerToken);
    expect(joinedA.you.role).toBe("owner");
    const b = await connect();
    await joinRoom(b, room.id, "Rahul");
    await a.nextMatch((m) => m.type === "MEMBERS"); // drain
    a.send({ type: "FILE_CREATE", path: "doc.txt" });
    const created = await a.nextMatch((m) => m.type === "FILE_EVENT" && m.event === "created");
    const fileId = created.file.id;

    // Seed two versions directly in the store (throttle needs clock jumps).
    const store = (collab as any).files as CollabFileStore;
    const seed = (text: string) => {
      const d = new Y.Doc();
      d.getText("content").insert(0, text);
      store.applyClientUpdate(room.id, fileId, Y.encodeStateAsUpdate(d), joinedA.you.id, "Sunny");
    };
    seed("first version");
    store.snapshotNow(room.id, fileId);
    t += 61_000;
    seed("first version plus more");
    store.snapshotNow(room.id, fileId);
    const versions = store.listVersions(room.id, fileId);
    expect(versions).toHaveLength(2);
    const v0 = versions[0]!;

    // Member cannot restore.
    b.send({ type: "VERSION_RESTORE", fileId, ts: v0.ts });
    expect(await b.nextMatch((m) => m.type === "ERROR")).toMatchObject({ code: "NOT_OWNER" });

    // Owner lists versions over WS and restores the older one.
    a.send({ type: "VERSION_LIST", fileId });
    const listed = await a.nextMatch((m) => m.type === "VERSIONS");
    expect(listed.versions).toHaveLength(2);
    a.send({ type: "VERSION_TEXT", fileId, ts: v0.ts });
    const preview = await a.nextMatch((m) => m.type === "VERSION_TEXT");
    expect(preview.text).toBe("first version");
    a.send({ type: "VERSION_RESTORE", fileId, ts: v0.ts });
    // Restore is broadcast as a normal update; open the file to receive it.
    const peer = new YjsPeer((kind, data) => a.send({ type: "YJS_SYNC", fileId, kind, data }));
    a.send({ type: "FILE_OPEN", fileId });
    peer.handle(await a.nextMatch((m) => m.type === "YJS_SYNC" && m.kind === "step1"));
    peer.handle(await a.nextMatch((m) => m.type === "YJS_SYNC" && m.kind === "step2"));
    expect(peer.text).toBe("first version");
  });
});
