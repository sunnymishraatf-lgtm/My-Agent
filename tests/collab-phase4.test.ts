/**
 * Phase 4 collaboration tests: AI approval flow, activity feed, permission
 * boundaries, and ui-utils.d.ts completeness for the Phase 2 helpers.
 *
 * - Pure helpers (parseRoomEditBlocks, diffLineBlocks/Stats)
 *   are tested through src/web/app/ui-utils.js (typed via ui-utils.d.ts —
 *   a missing declaration fails `npm run typecheck`).
 * - Approval convergence is tested through the real CollabFileStore + yjs:
 *   the exact primitives the client's Apply path uses
 *   (diffTextToOps -> applyOpsToYText -> Yjs update -> broadcast -> merge).
 * - Activity aggregation/throttling and the AI_APPLY permission gate are
 *   tested over a real WebSocket against CollabServer.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { mkdtempSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { WebSocket } from "ws";
import * as Y from "yjs";
import ui from "../src/web/app/ui-utils.js";
import { RoomManager } from "../src/server/collab/room-manager";
import { CollabServer, encodeSyncFrame } from "../src/server/collab/collab-server";
import { CollabFileStore, diffTextOps, applyOpsToYText } from "../src/server/collab/file-store";

// ----- pure helpers -------------------------------------------------------

describe("parseRoomEditBlocks", () => {
  it("parses a single edit block and strips it from the text", () => {
    const text = "Here is the fix:\n```neutron-room-edit\npath: src/app.ts\nconst x = 1;\n```\nDone.";
    const r = ui.parseRoomEditBlocks(text);
    expect(r.blocks).toEqual([{ path: "src/app.ts", content: "const x = 1;" }]);
    expect(r.stripped).toBe("Here is the fix:\n\nDone.");
    expect(r.stripped).not.toContain("neutron-room-edit");
  });
  it("parses multiple blocks", () => {
    const text =
      "```neutron-room-edit\npath: a.ts\nAAA\n```\nbetween\n```neutron-room-edit\npath: b.ts\nBBB\n```";
    const r = ui.parseRoomEditBlocks(text);
    expect(r.blocks.map((b) => b.path)).toEqual(["a.ts", "b.ts"]);
    expect(r.blocks[1]?.content).toBe("BBB");
    expect(r.stripped).toBe("between");
  });
  it("ignores ordinary code fences and blocks without a path", () => {
    const text = "```js\nconsole.log(1)\n```\n```neutron-room-edit\nno path here\n```";
    const r = ui.parseRoomEditBlocks(text);
    expect(r.blocks).toEqual([]);
    expect(r.stripped).toContain("console.log(1)");
  });
  it("handles empty / null input", () => {
    expect(ui.parseRoomEditBlocks("")).toEqual({ blocks: [], stripped: "" });
    expect(ui.parseRoomEditBlocks(null)).toEqual({ blocks: [], stripped: "" });
  });
});

describe("diffLineBlocks / diffLineStats", () => {
  it("counts added and removed lines (prefix/suffix diff)", () => {
    // a=[a,b,c], b=[a,B,c,d]: prefix "a", no common suffix ->
    // 2 removed (b,c), 3 added (B,c,d).
    const s = ui.diffLineStats("a\nb\nc", "a\nB\nc\nd");
    expect(s).toEqual({ added: 3, removed: 2 });
  });
  it("reports zero for identical texts", () => {
    expect(ui.diffLineStats("x\ny", "x\ny")).toEqual({ added: 0, removed: 0 });
  });
  it("marks rows with add/del/context", () => {
    const rows = ui.diffLineBlocks("a\nb", "a\nc");
    expect(rows).toEqual([
      { t: " ", text: "a" },
      { t: "del", text: "b" },
      { t: "add", text: "c" },
    ]);
  });
});

describe("ui-utils.d.ts completeness (Phase 2 helpers)", () => {
  it("b64encodeBytes / b64decodeBytes round-trip", () => {
    const bytes = new Uint8Array([0, 1, 2, 250, 255]);
    const s = ui.b64encodeBytes(bytes);
    expect(ui.b64decodeBytes(s)).toEqual(bytes);
    expect(ui.b64decodeBytes("!!!not-base64!!!")).toBeNull();
  });
  it("encodeSyncFrame / decodeSyncFrame round-trip", () => {
    const payload = new Uint8Array([9, 8, 7]);
    const frame = ui.encodeSyncFrame(2, payload);
    const dec = ui.decodeSyncFrame(frame);
    expect(dec).not.toBeNull();
    expect(dec!.type).toBe(2);
    expect(dec!.payload).toEqual(payload);
    expect(ui.decodeSyncFrame(new Uint8Array([1]))).toBeNull();
  });
  it("diffTextToOps produces applicable ops", () => {
    const ops = ui.diffTextToOps("hello world", "hello brave world");
    expect(ops.length).toBeGreaterThan(0);
    // apply manually
    let idx = 0;
    let out = "";
    const src = "hello world";
    for (const op of ops) {
      if (op.retain) { out += src.slice(idx, idx + op.retain); idx += op.retain; }
      if (op.delete) idx += op.delete;
      if (op.insert) out += op.insert;
    }
    out += src.slice(idx);
    expect(out).toBe("hello brave world");
  });
  it("indexToLineCol maps offsets", () => {
    expect(ui.indexToLineCol("ab\ncd", 0)).toEqual({ line: 1, col: 1 });
    expect(ui.indexToLineCol("ab\ncd", 3)).toEqual({ line: 2, col: 1 });
    expect(ui.indexToLineCol("ab\ncd", 4)).toEqual({ line: 2, col: 2 });
  });
  it("sanitizeCollabPath mirrors the server", () => {
    expect(ui.sanitizeCollabPath("docs/notes.md")).toBe("docs/notes.md");
    expect(ui.sanitizeCollabPath("../evil")).toBeNull();
    expect(ui.sanitizeCollabPath("/abs")).toBeNull();
  });
  it("pickPresenceColor is deterministic", () => {
    expect(ui.pickPresenceColor("m_abc")).toBe(ui.pickPresenceColor("m_abc"));
    expect(ui.pickPresenceColor("m_abc")).toMatch(/^#[0-9a-fA-F]{6}$/);
  });
  it("buildFileTree nests dirs first", () => {
    const tree = ui.buildFileTree([
      { id: "1", path: "b.ts" },
      { id: "2", path: "src/a.ts" },
    ]);
    expect(tree[0]?.dir).toBe(true);
    expect(tree[0]?.name).toBe("src");
    expect(tree[1]?.dir).toBe(false);
  });
});

// ----- approval convergence through the real CRDT path --------------------

describe("AI approval: apply goes through Yjs and converges; reject changes nothing", () => {
  let store: CollabFileStore;
  const ROOM = "NEUTRON-AAAAAA";
  beforeEach(() => {
    store = new CollabFileStore(mkdtempSync(join(tmpdir(), "neutron-collab-p4-")));
  });

  /** Mirror of the client's applyAiCard: ops from the AI block -> Yjs txn. */
  function clientApply(doc: Y.Doc, oldText: string, newContent: string): Uint8Array {
    const ops = diffTextOps(oldText, newContent);
    const before = Y.encodeStateVector(doc);
    doc.transact(() => {
      applyOpsToYText(doc.getText("content"), ops);
    }, "ai-apply");
    return Y.encodeStateAsUpdate(doc, before);
  }

  it("an approved AI change converges on a second peer via the server relay", () => {
    const created = store.createFile(ROOM, "src/app.ts", "m_1", "Sunny");
    expect("error" in created).toBe(false);
    const fileId = (created as { meta: { id: string } }).meta.id;

    // Peer A (the approver) and peer B start from the synced empty doc.
    const docA = new Y.Doc();
    const docB = new Y.Doc();
    const seed = Y.encodeStateAsUpdate(docA);
    Y.applyUpdate(docB, seed);

    // AI proposes new content; the approver applies it locally (client path).
    const newContent = "const server = 1;\nserver.listen(3000);\n";
    const update = clientApply(docA, "", newContent);

    // Server applies the client's update (what handleYjsSync does) and the
    // broadcast update merges cleanly into peer B: CRDT convergence.
    const applied = store.applyClientUpdate(ROOM, fileId, update, "m_1", "Sunny");
    expect("error" in applied).toBe(false);
    Y.applyUpdate(docB, (applied as { update: Uint8Array }).update);

    expect(docB.getText("content").toString()).toBe(newContent);
    expect(store.fileText(ROOM, fileId)).toBe(newContent);
  });

  it("a rejected AI change touches nothing", () => {
    const created = store.createFile(ROOM, "src/app.ts", "m_1", "Sunny");
    const fileId = (created as { meta: { id: string } }).meta.id;
    const before = store.fileText(ROOM, fileId);
    // Reject = the client never calls apply; the AI block is discarded.
    const parsed = ui.parseRoomEditBlocks("```neutron-room-edit\npath: src/app.ts\nEVIL\n```");
    expect(parsed.blocks).toHaveLength(1);
    // ...and nothing is applied:
    expect(store.fileText(ROOM, fileId)).toBe(before);
    expect(store.fileText(ROOM, fileId)).toBe("");
  });

  it("concurrent AI apply and peer edit both survive (no overwrite)", () => {
    const created = store.createFile(ROOM, "src/app.ts", "m_1", "Sunny");
    const fileId = (created as { meta: { id: string } }).meta.id;
    const docA = new Y.Doc();
    const docB = new Y.Doc();
    // Both peers insert at position 0 concurrently (classic conflict).
    docA.getText("content").insert(0, "AAA");
    docB.getText("content").insert(0, "BBB");
    const uA = Y.encodeStateAsUpdate(docA);
    const uB = Y.encodeStateAsUpdate(docB);
    const rA = store.applyClientUpdate(ROOM, fileId, uA, "m_1", "Sunny");
    const rB = store.applyClientUpdate(ROOM, fileId, uB, "m_2", "Rahul");
    expect("error" in rA).toBe(false);
    expect("error" in rB).toBe(false);
    const text = store.fileText(ROOM, fileId)!;
    // CRDT: neither edit is lost, regardless of order.
    expect(text).toContain("AAA");
    expect(text).toContain("BBB");
  });
});

// ----- activity feed: manager --------------------------------------------

describe("RoomManager activity feed", () => {
  let mgr: RoomManager;
  const t = { now: 1_000_000 };
  beforeEach(() => {
    mgr = new RoomManager(mkdtempSync(join(tmpdir(), "neutron-collab-act-")), () => t.now);
  });

  it("caps the feed at 50 entries", () => {
    const { room } = mgr.createRoom("Team");
    for (let i = 0; i < 60; i++) {
      mgr.postActivity(room.id, { kind: "file_edit", by: "m_1", byName: "Sunny", path: "a.ts" });
    }
    const feed = mgr.getActivity(room.id);
    expect(feed).toHaveLength(50);
    expect(feed[49]?.kind).toBe("file_edit");
  });

  it("persists activity in the room snapshot", () => {
    const { room } = mgr.createRoom("Team");
    mgr.postActivity(room.id, { kind: "member_join", by: "m_1", byName: "Sunny" });
    mgr.saveNow();
    // The snapshot file itself carries the feed (persistence contract).
    const snap = JSON.parse(readFileSync(mgr.snapshotPath, "utf8")) as {
      rooms: Array<{ activity: Array<{ kind: string; byName: string }> }>;
    };
    expect(snap.rooms).toHaveLength(1);
    expect(snap.rooms[0]?.activity).toHaveLength(1);
    expect(snap.rooms[0]?.activity[0]).toMatchObject({ kind: "member_join", byName: "Sunny" });
  });

  it("reload restores the feed when the root is shared", () => {
    const { room } = mgr.createRoom("Team");
    mgr.postActivity(room.id, { kind: "voice_start", by: "m_2", byName: "Rahul" });
    mgr.saveNow();
    const root = (mgr as unknown as { dataRoot: string }).dataRoot;
    const mgr2 = new RoomManager(root, () => t.now);
    mgr2.load();
    expect(mgr2.getActivity(room.id)).toHaveLength(1);
    expect(mgr2.getActivity(room.id)[0]).toMatchObject({ kind: "voice_start", byName: "Rahul" });
  });
});

// ----- activity + AI_APPLY over a real WebSocket --------------------------

class TestClient {
  ws: WebSocket;
  private queue: unknown[] = [];
  private waiters: Array<(m: never) => void> = [];
  constructor(url: string) {
    this.ws = new WebSocket(url);
    this.ws.on("message", (data) => {
      const m = JSON.parse(String(data)) as never;
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
  async next(timeoutMs = 4000): Promise<any> {
    const queued = this.queue.shift();
    if (queued !== undefined) return Promise.resolve(queued);
    return new Promise((res, rej) => {
      const timer = setTimeout(() => rej(new Error("timed out waiting for server message")), timeoutMs);
      this.waiters.push(((m: never) => {
        clearTimeout(timer);
        res(m);
      }) as (m: never) => void);
    });
  }
  close(): void {
    try {
      this.ws.close();
    } catch {
      /* ignore */
    }
  }
}

let server: Server;
let collab: CollabServer;
let mgr: RoomManager;
let url: string;
let t: number;
const clients: TestClient[] = [];

beforeEach(async () => {
  t = 1_000_000;
  mgr = new RoomManager(mkdtempSync(join(tmpdir(), "neutron-collab-p4-")), () => t);
  collab = new CollabServer({ manager: mgr, now: () => t, heartbeatMs: 60_000, sweepMs: 60_000 });
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

async function joinRoom(c: TestClient, code: string, name: string): Promise<any> {
  c.send({ type: "ROOM_JOIN", roomId: code, displayName: name });
  const joined = await c.next();
  expect(joined.type).toBe("JOINED");
  return joined;
}

/** Have the client open a file; consume the server's step1 reply. */
async function openFile(c: TestClient, fileId: string): Promise<void> {
  c.send({ type: "FILE_OPEN", fileId });
  const step1 = await c.next();
  expect(step1.type).toBe("YJS_SYNC");
  expect(step1.kind).toBe("step1");
}

function yjsUpdateFrame(text: string): string {
  const doc = new Y.Doc();
  doc.getText("content").insert(0, text);
  const update = Y.encodeStateAsUpdate(doc);
  return Buffer.from(encodeSyncFrame(2, update)).toString("base64");
}

describe("activity feed over WebSocket", () => {
  it("JOINED carries recent activity", async () => {
    const { room } = mgr.createRoom("Team");
    const a = await connect();
    const joined = await joinRoom(a, room.id, "Sunny");
    expect(Array.isArray(joined.activity)).toBe(true);
    expect(joined.activity.map((e: { kind: string }) => e.kind)).toContain("member_join");
  });

  it("file edits aggregate: rapid updates produce one feed entry per 2 min", async () => {
    const { room } = mgr.createRoom("Team");
    const a = await connect();
    await joinRoom(a, room.id, "Sunny");
    a.send({ type: "FILE_CREATE", path: "src/app.ts" });
    const created = await a.next();
    expect(created.type).toBe("FILE_EVENT");
    const fileId = created.file.id as string;
    await a.next(); // ACTIVITY file_create
    await openFile(a, fileId);
    // Two rapid live edits: the first emits a feed entry, the second is throttled.
    a.send({ type: "YJS_SYNC", fileId, kind: "update", data: yjsUpdateFrame("one") });
    a.send({ type: "YJS_SYNC", fileId, kind: "update", data: yjsUpdateFrame("onetwo") });
    const act = await a.next();
    expect(act.type).toBe("ACTIVITY");
    expect(act.event.kind).toBe("file_edit");
    // Ordered delivery: FILE_LIST_RESULT proves both updates were processed.
    a.send({ type: "FILE_LIST" });
    const listed = await a.next();
    expect(listed.type).toBe("FILE_LIST_RESULT");
    // The throttle aggregated both edits into a single entry.
    const edits = mgr.getActivity(room.id).filter((e) => e.kind === "file_edit");
    expect(edits).toHaveLength(1);
    expect(edits[0]).toMatchObject({ byName: "Sunny", path: "src/app.ts" });
  });

  it("AI_APPLY from a member broadcasts an ai_apply entry; non-members are rejected", async () => {
    const { room } = mgr.createRoom("Team");
    const a = await connect();
    await joinRoom(a, room.id, "Sunny");
    a.send({ type: "FILE_CREATE", path: "src/app.ts" });
    const created = await a.next();
    expect(created.type).toBe("FILE_EVENT");
    const fileId = created.file.id as string;
    await a.next(); // ACTIVITY file_create
    await openFile(a, fileId);

    // B joins after the setup; its next ACTIVITY will be the ai_apply.
    const b = await connect();
    await joinRoom(b, room.id, "Rahul");

    a.send({ type: "AI_APPLY", fileId });
    const act = await b.next();
    expect(act.type).toBe("ACTIVITY");
    expect(act.event.kind).toBe("ai_apply");
    expect(act.event.byName).toBe("Sunny");
    expect(act.event.path).toBe("src/app.ts");

    // A stranger who never joined gets NOT_JOINED and leaves no trace.
    const c = await connect();
    c.send({ type: "AI_APPLY", fileId: "f_0123456789abcdef" });
    expect(await c.next()).toMatchObject({ type: "ERROR", code: "NOT_JOINED" });
    expect(mgr.getActivity(room.id).filter((e) => e.kind === "ai_apply")).toHaveLength(1);
  });

  it("AI_APPLY requires the file to be open", async () => {
    const { room } = mgr.createRoom("Team");
    const a = await connect();
    await joinRoom(a, room.id, "Sunny");
    a.send({ type: "FILE_CREATE", path: "src/app.ts" });
    const created = await a.next();
    const fileId = created.file.id as string;
    await a.next(); // ACTIVITY file_create
    // Never opened the file: rejected.
    a.send({ type: "AI_APPLY", fileId });
    expect(await a.next()).toMatchObject({ type: "ERROR", code: "INVALID_PAYLOAD" });
    expect(mgr.getActivity(room.id).filter((e) => e.kind === "ai_apply")).toHaveLength(0);
  });

  it("voice start/end appear in the feed", async () => {
    const { room } = mgr.createRoom("Team");
    const a = await connect();
    await joinRoom(a, room.id, "Sunny");
    a.send({ type: "VOICE_JOIN" });
    const members = await a.next();
    expect(members.type).toBe("VOICE_MEMBERS");
    const started = await a.next();
    expect(started.type).toBe("ACTIVITY");
    expect(started.event.kind).toBe("voice_start");
    a.send({ type: "VOICE_LEAVE" });
    const ended = await a.next();
    expect(ended.type).toBe("ACTIVITY");
    expect(ended.event.kind).toBe("voice_end");
  });
});

describe("server-authorized AI context (AI_CONTEXT_REQUEST)", () => {
  /** Create a room file with text content; returns the file id. */
  async function createFileWithText(c: any, path: string, text: string): Promise<string> {
    c.send({ type: "FILE_CREATE", path });
    const created = await c.next();
    expect(created.type).toBe("FILE_EVENT");
    const fileId = created.file.id as string;
    await c.next(); // ACTIVITY file_create
    await openFile(c, fileId); // the server only accepts updates for open files
    c.send({ type: "YJS_SYNC", fileId, kind: "update", data: yjsUpdateFrame(text) });
    const editAct = await c.next();
    expect(editAct.type).toBe("ACTIVITY"); // file_edit feed entry
    // Ordered delivery: the AI_CONTEXT reply below proves the update landed.
    return fileId;
  }

  async function requestCtx(c: any, req: Record<string, unknown>): Promise<any> {
    c.send({ type: "AI_CONTEXT_REQUEST", requestId: "r-" + Math.random().toString(36).slice(2), ...req });
    const res = await c.next();
    expect(res.type).toBe("AI_CONTEXT");
    return res;
  }

  it("returns server-owned file text to a room member", async () => {
    const { room } = mgr.createRoom("Team");
    const a = await connect();
    await joinRoom(a, room.id, "Sunny");
    const fileId = await createFileWithText(a, "src/app.ts", "const answer = 42;");
    const res = await requestCtx(a, { mode: "file", fileId });
    expect(res.ok).toBe(true);
    expect(res.path).toBe("src/app.ts");
    expect(res.text).toBe("const answer = 42;");
    expect(res.truncated).toBe(false);
    expect(mgr.getActivity(room.id).some((e) => e.kind === "ai_apply")).toBe(false);
  });

  it("snippet mode extracts the selection server-side from indices", async () => {
    const { room } = mgr.createRoom("Team");
    const a = await connect();
    await joinRoom(a, room.id, "Sunny");
    const fileId = await createFileWithText(a, "src/app.ts", "hello world");
    const res = await requestCtx(a, { mode: "snippet", fileId, selStart: 0, selEnd: 5 });
    expect(res.ok).toBe(true);
    expect(res.text).toBe("hello");
    // Out-of-range indices are clamped, not rejected.
    const res2 = await requestCtx(a, { mode: "snippet", fileId, selStart: 6, selEnd: 999 });
    expect(res2.ok).toBe(true);
    expect(res2.text).toBe("world");
    expect(room.id).toBeTruthy();
  });

  it("list mode returns room file paths without content", async () => {
    const { room } = mgr.createRoom("Team");
    const a = await connect();
    await joinRoom(a, room.id, "Sunny");
    await createFileWithText(a, "src/app.ts", "x");
    const res = await requestCtx(a, { mode: "list" });
    expect(res.ok).toBe(true);
    expect(res.files).toEqual([{ id: expect.any(String), path: "src/app.ts" }]);
    expect(res.text).toBeUndefined();
    expect(room.id).toBeTruthy();
  });

  it("a non-member gets ok:false and zero file content", async () => {
    const { room } = mgr.createRoom("Team");
    const a = await connect();
    await joinRoom(a, room.id, "Sunny");
    const fileId = await createFileWithText(a, "src/secret.ts", "TOP-SECRET-CONTENT");
    const outsider = await connect(); // never joins the room
    outsider.send({ type: "AI_CONTEXT_REQUEST", requestId: "r-out", mode: "file", fileId });
    const res = await outsider.next();
    expect(res.type).toBe("AI_CONTEXT");
    expect(res.ok).toBe(false);
    expect(res.code).toBe("NOT_JOINED");
    expect(res.text).toBeUndefined();
    expect(JSON.stringify(res)).not.toContain("TOP-SECRET-CONTENT");
    expect(room.id).toBeTruthy();
  });

  it("unknown file ids are rejected without content", async () => {
    const { room } = mgr.createRoom("Team");
    const a = await connect();
    await joinRoom(a, room.id, "Sunny");
    const res = await requestCtx(a, { mode: "file", fileId: "f_0000000000000000" });
    expect(res.ok).toBe(false);
    expect(res.code).toBe("FILE_NOT_FOUND");
    expect(res.text).toBeUndefined();
    expect(room.id).toBeTruthy();
  });

  it("large files are truncated with the flag set", async () => {
    const { room } = mgr.createRoom("Team");
    const a = await connect();
    await joinRoom(a, room.id, "Sunny");
    const fileId = await createFileWithText(a, "src/big.ts", "z".repeat(70_000));
    const res = await requestCtx(a, { mode: "file", fileId });
    expect(res.ok).toBe(true);
    expect(res.text).toHaveLength(60_000);
    expect(res.truncated).toBe(true);
    expect(room.id).toBeTruthy();
  });
});
